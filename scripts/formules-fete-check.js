#!/usr/bin/env node
'use strict';
// =============================================================================
// LES FORMULES EN FETE : LA GUIRLANDE DES ANNIVERSAIRES, LA VRAIE PHOTO EN
// FOND DE CARTE, LA REMISE DES OFFRES SPECIALES
// -----------------------------------------------------------------------------
// Movsar, 2026-10-14 au soir : « les formules devraient etre plus belles
// visuellement, un peu enfantin parce que c est pour des anniv ; les autres
// formules speciales, un design a part » ; « des dessins festifs ou
// directement des images festives de Fun Galaxy, des vraies images » ; sur la
// maquette : « les images en haut rallongent la carte, fais en sorte que ce
// soit dedans direct pour garder une taille ok ; les fanions, plus styles ; les
// speciales : garde le design des formules normal mais donne-leur un petit
// truc special pour montrer que c est pas vide » ; « plus sombre les images
// pour mieux voir les textes ».
//
//   [A] chaque formule de la famille des anniversaires porte la guirlande (une
//       tuile SVG repetee « round » : jamais un feston coupe) et 9 px de plus en
//       haut ; aucune autre formule ;
//   [B] a Libramont, chaque carte a en fond la photo d une activite qu elle
//       contient, prise dans le centre ; une section ne repete pas une photo
//       quand la formule en contient une autre ; une formule refusee ce
//       jour-la ne montre pas la sienne ; chaque fichier existe et reste leger ;
//   [C] la photo ne change pas la taille de la carte (elle est en fond) ;
//   [D] le texte passe devant la photo, sous un voile noir d au moins 74 % (le
//       contraste au pire, photo blanche, est mesure par fungalaxy-form-check
//       [L]) ;
//   [E] une offre speciale dit sa remise quand le centre affiche un ancien
//       prix, au pourcent pres ; un anniversaire, jamais ;
//   [F] les photos ne se chargent qu a l ouverture de l onglet des formules ;
//   [G] un autre centre ne recoit aucune photo de Libramont (la guirlande,
//       elle, reste) ;
//   [H] rien ne deborde, a 320, 390 et 1440 px ;
//   [I] le catalogue servi ecrit « jours fériés » avec ses accents ;
//   [J] contre-epreuves servies en memoire : chaque regle retiree, ce gate
//       ROUGIT, et le depot n est jamais touche.
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PINLANE_FORMULES_FETE_PORT || 4397);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
process.env.PINLANE_DEVTUNNEL_PORT = String(PORT);
process.env.PINLANE_CALENDAR_SYNC = 'off';
// Une photo de fond de carte se lit sous un voile noir : au-dela, elle pese
// pour rien sur un telephone (la plus lourde, la plaine, fait 36,5 Ko).
const POIDS_PHOTO_MAX = 40 * 1024;
// Ce qu une photo montre, et les mots d une ligne de carte qui le nomment.
const SUJETS = [
  [/^(pistes-neon|salle-bowling)$/, /bowling/i],
  [/^laser-/, /laser/i],
  [/^minigolf$/, /golf/i],
  [/^(arcades|simulateurs)$/, /arcade/i],
  [/^plaine$/, /plaine|playground/i],
  [/^duckpin$/, /duck/i],
  [/^fun-run$/, /fun.?run/i],
  [/^billards-libramont$/, /billard/i],
];

let echecs = 0;
let muet = false;
let rouges = 0;
function ok(cond, label, detail) {
  if (!cond) rouges += 1;
  if (muet) return Boolean(cond);
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}
function section(titre) { if (!muet) console.log(`\n[${titre}]`); }
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (error) { return false; }
}
const sansEspaces = (s) => String(s || '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Le serveur : le mock du depot, et des contre-epreuves servies en memoire.
// ---------------------------------------------------------------------------
const MUTATIONS = {
  fete: ['js', '      var fete = /anniv/i.test(cle), vues = {};\n', '      var fete = false, vues = {};\n'],
  repete: ['js', "    var p = cands.filter(function (c) { return !vues[c]; })[0] || cands[0] || '';\n", "    var p = cands[0] || '';\n"],
  partout: ['js', "    if ((meta && meta.center && meta.center.id || CENTER) !== 'libramont') return '';\n", '    if (false) return \'\';\n'],
  remiseAnniv: ['js', '        var remise = !fete && Number(f.price) > 0', '        var remise = Number(f.price) > 0'],
  remiseFausse: ['js', 'Math.round((1 - Number(f.price) / Number(f.oldPrice)) * 100)', 'Math.round(Number(f.price) / Number(f.oldPrice) * 100)'],
  tot: ['js', 'alt="" loading="lazy" decoding="async"', 'alt="" decoding="async"'],
  dansLeFlux: ['css', '.fg-for__photo { position: absolute; inset: 0;', '.fg-for__photo { position: relative; inset: 0;'],
  voileClair: ['css', 'rgba(5, 5, 5, 0.74) 0%', 'rgba(5, 5, 5, 0.3) 0%'],
  refusAvecPhoto: ['css', '.fg-card.is-refus .fg-for__photo { display: none; }\n', ''],
  festonCoupe: ['css', '0 0 / 85px 20px round no-repeat', '0 0 / 85px 20px repeat-x'],
  feries: ['meta', 'jours fériés', 'jours feries'],
};
let mutation = '';
const lireSource = (f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8').replace(/\r\n/g, '\n');
function serveur(mock) {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const seaux = globalThis.__pinlaneRateBuckets;
    if (seaux) [...seaux.keys()].filter((k) => /^public-(availability|holds|reservations|booking-meta):/.test(k)).forEach((k) => seaux.delete(k));
    const url = new URL(req.url, BASE_URL);
    const m = mutation ? MUTATIONS[mutation] : null;
    const fichier = url.pathname === '/assets/fungalaxy-booking.js' ? 'js' : url.pathname === '/assets/fungalaxy-booking.css' ? 'css' : '';
    if (m && fichier && m[0] === fichier) {
      const src = lireSource(`fungalaxy-booking.${fichier}`);
      res.writeHead(200, { 'Content-Type': `${fichier === 'js' ? 'text/javascript' : 'text/css'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(src.split(m[1]).join(m[2]));
      return;
    }
    if (m && m[0] === 'meta' && url.pathname === '/api/public-booking-meta' && req.method === 'GET' && !req.headers['x-qa-brut']) {
      // Le catalogue tel que le serveur l ecrirait sans la regle.
      const proxy = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: 'GET', headers: { ...req.headers, 'x-qa-brut': '1', 'accept-encoding': 'identity' } }, (r) => {
        let corps = ''; r.setEncoding('utf8'); r.on('data', (c) => { corps += c; });
        r.on('end', () => { res.writeHead(r.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(corps.split(m[1]).join(m[2])); });
      });
      proxy.on('error', () => { res.writeHead(502); res.end('{}'); });
      proxy.end();
      return;
    }
    if (req.headers['x-qa-brut']) delete req.headers['x-qa-brut'];
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}
function ancreUnique(nom) {
  const [type, avant] = MUTATIONS[nom];
  if (type === 'meta') return true;
  return lireSource(`fungalaxy-booking.${type}`).split(avant).length === 2;
}
async function lireMeta() {
  const corps = await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/public-booking-meta?centerId=libramont&qa=${Date.now()}`, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
  return JSON.parse(corps);
}

// ---------------------------------------------------------------------------
// Le parcours : un samedi du mock, 10 personnes, l onglet des formules.
// ---------------------------------------------------------------------------
async function versFormules(page, date, pax, { ouvrir = true } = {}) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
  await page.click('#dayBtn');
  const [y, mo] = date.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  await attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, date);
  await page.click(`#calGrid .fg-cal__day[data-date="${date}"]`);
  await attendre(page, () => document.querySelector('#dayPop').hidden, 3000);
  await page.fill('#paxInput', String(pax));
  await page.press('#paxInput', 'Enter');
  await attendre(page, (n) => document.querySelector('#paxInput').value === String(n), 3000, pax);
  await page.click('#goActivities');
  await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
  if (!ouvrir) return true;
  await page.click('#tabFor');
  const vu = await attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-card--formule').length > 0, 5000);
  // AU REPOS : les cartes entrent en fondu (fg-rise) et une carte qui monte
  // compte encore son decalage dans les mesures.
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 8000);
  // Les photos sont chargees au besoin (loading="lazy") : la liste se parcourt
  // jusqu en bas pour qu elles arrivent toutes, puis on remonte.
  await page.evaluate(async () => {
    const bas = document.querySelector('#gridFor').getBoundingClientRect().bottom + scrollY;
    for (let y = 0; y < bas; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, 0);
  });
  await attendre(page, () => Array.from(document.querySelectorAll('#gridFor .fg-for__photo img')).every((i) => getComputedStyle(i.parentElement).display === 'none' || (i.complete && i.naturalWidth > 0)), 8000);
  return vu;
}

// Tout ce que [A] a [H] lisent, en une fois.
async function lireCartes(page) {
  return page.evaluate(() => {
    const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return 1; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return p.length > 3 ? p[3] : 1; };
    return Array.from(document.querySelectorAll('#gridFor .fg-fam')).map((fam) => ({
      titre: (fam.querySelector('.fg-fam__title') || {}).textContent || '',
      cartes: Array.from(fam.querySelectorAll('.fg-card--formule')).map((c) => {
        const cs = getComputedStyle(c);
        const avant = getComputedStyle(c, '::before');
        const ph = c.querySelector('.fg-for__photo');
        const img = ph && ph.querySelector('img');
        const voile = ph ? getComputedStyle(ph, '::after').backgroundImage : '';
        const r = c.getBoundingClientRect();
        const rp = ph ? ph.getBoundingClientRect() : null;
        const nom = c.querySelector('.fg-card__name');
        const remise = c.querySelector('.fg-for__remise');
        const debord = Array.from(c.querySelectorAll('*')).filter((e) => e.getClientRects().length && getComputedStyle(e).position !== 'absolute')
          .some((e) => { const x = e.getBoundingClientRect(); return x.right > r.right + 0.5 || x.left < r.left - 0.5; });
        return {
          id: c.dataset.formule,
          fete: c.classList.contains('is-fete'),
          refus: c.classList.contains('is-refus'),
          avantContenu: avant.content,
          avantFond: avant.backgroundImage,
          avantRepetition: avant.backgroundRepeat,
          avantHauteur: parseFloat(avant.height) || 0,
          hautInterne: parseFloat(cs.paddingTop),
          lignes: Array.from(c.querySelectorAll('.fg-for__list li')).map((li) => li.textContent),
          photo: img ? img.getAttribute('src') : '',
          photoVue: ph ? getComputedStyle(ph).display !== 'none' : false,
          photoChargee: img ? img.complete && img.naturalWidth > 0 : false,
          photoPose: ph ? { position: getComputedStyle(ph).position, z: getComputedStyle(ph).zIndex, couvre: rp.width > 0 && Math.abs(rp.left - r.left) <= 1.5 && Math.abs(rp.right - r.right) <= 1.5 && Math.abs(rp.top - r.top) <= 1.5 && Math.abs(rp.bottom - r.bottom) <= 1.5 } : null,
          voileMin: voile ? Math.min(...(voile.match(/rgba?\([^)]+\)/g) || ['rgba(0,0,0,0)']).map(alpha)) : null,
          texteZ: nom ? { position: getComputedStyle(nom.parentElement).position, z: getComputedStyle(nom.parentElement).zIndex } : null,
          remise: remise ? remise.textContent : '',
          hauteur: r.height,
          debord,
        };
      }),
    }));
  });
}
async function hauteursSansPhoto(page) {
  return page.evaluate(() => {
    const avant = Array.from(document.querySelectorAll('#gridFor .fg-card--formule')).map((c) => ({ id: c.dataset.formule, h: c.getBoundingClientRect().height }));
    const ote = [];
    document.querySelectorAll('#gridFor .fg-for__photo').forEach((p) => { ote.push([p, p.parentElement, p.nextSibling]); p.remove(); });
    const apres = Array.from(document.querySelectorAll('#gridFor .fg-card--formule')).map((c) => c.getBoundingClientRect().height);
    ote.forEach(([p, parent, suivant]) => parent.insertBefore(p, suivant));
    return avant.map((x, i) => ({ ...x, sans: apres[i] }));
  });
}

// ---------------------------------------------------------------------------
// Les regles
// ---------------------------------------------------------------------------
function verifierFete(familles, largeur) {
  section(`A. LA GUIRLANDE DES ANNIVERSAIRES (${largeur} px)`);
  const anniv = familles.find((f) => /anniv/i.test(f.titre));
  const autres = familles.filter((f) => f !== anniv);
  if (!ok(Boolean(anniv) && anniv.cartes.length > 0 && autres.length > 0 && autres.every((f) => f.cartes.length > 0), 'MONTAGE la famille des anniversaires et une autre famille sont affichees', familles.map((f) => `${sansEspaces(f.titre)} ${f.cartes.length}`).join(' | '))) return;
  const sansGuirlande = anniv.cartes.filter((c) => !(c.fete && c.avantContenu !== 'none' && /data:image\/svg\+xml/.test(c.avantFond) && c.avantHauteur >= 16));
  ok(sansGuirlande.length === 0, 'chaque formule anniversaire porte la guirlande de fanions', sansGuirlande.map((c) => c.id).join(' ') || `${anniv.cartes.length} cartes`);
  const enTrop = autres.flatMap((f) => f.cartes).filter((c) => c.fete || /svg/.test(c.avantFond));
  ok(enTrop.length === 0, 'aucune autre formule ne porte de guirlande', enTrop.map((c) => c.id).join(' '));
  ok(anniv.cartes.every((c) => /^round/.test(c.avantRepetition)), 'la tuile se repete « round » : jamais un feston coupe au bord', [...new Set(anniv.cartes.map((c) => c.avantRepetition))].join(' | '));
  const base = autres.flatMap((f) => f.cartes)[0].hautInterne;
  ok(anniv.cartes.every((c) => Math.abs(c.hautInterne - (base + 9)) < 0.5), 'la guirlande prend 9 px en haut, rien d autre', `${anniv.cartes[0].hautInterne} px contre ${base} px`);
}
function verifierPhotos(familles, largeur) {
  section(`B. LA VRAIE PHOTO EN FOND (${largeur} px, Libramont)`);
  const toutes = familles.flatMap((f) => f.cartes);
  const sans = toutes.filter((c) => !/^\/assets\/fungalaxy\/[a-z-]+-carte\.webp$/.test(c.photo));
  ok(toutes.length > 0 && sans.length === 0, 'chaque carte a une photo du centre en fond', sans.map((c) => c.id).join(' ') || `${toutes.length} cartes`);
  const fichier = (c) => c.photo.replace(/^\/assets\/fungalaxy\//, '').replace(/-carte\.webp$/, '');
  const hors = toutes.filter((c) => c.photo && !(c.lignes.some((l) => /toutes les activit[eé]s/i.test(l)) || SUJETS.some(([f, mot]) => f.test(fichier(c)) && c.lignes.some((l) => mot.test(l)))));
  ok(hors.length === 0, 'la photo montre une activite que la formule contient (« toutes les activites » : une du centre)', hors.map((c) => `${c.id}=${fichier(c)}`).join(' ') || toutes.map((c) => `${c.id}=${fichier(c)}`).join(' '));
  familles.forEach((f) => {
    const vues = f.cartes.map(fichier);
    ok(new Set(vues).size === vues.length, `« ${sansEspaces(f.titre).replace(/\d+ formules?$/, '').trim()} » : jamais deux fois la meme photo dans la section`, vues.join(' '));
  });
  const refusees = toutes.filter((c) => c.refus);
  ok(refusees.length > 0, 'MONTAGE une formule est refusee ce jour-la (une offre de semaine, un samedi)', refusees.map((c) => c.id).join(' '));
  ok(refusees.every((c) => !c.photoVue) && toutes.filter((c) => !c.refus).every((c) => c.photoVue && c.photoChargee), 'refusee, une formule ne montre pas sa photo ; sinon la photo est chargee et vue',
    toutes.map((c) => `${c.id}:${c.refus ? 'refus' : 'ok'}/${c.photoVue ? 'vue' : 'cachee'}${c.photoChargee ? '' : '/non chargee'}`).join(' '));
  const lourdes = [...new Set(toutes.map(fichier).filter(Boolean))].map((p) => ({ p, o: fs.existsSync(path.join(ROOT, 'assets', 'fungalaxy', `${p}-carte.webp`)) ? fs.statSync(path.join(ROOT, 'assets', 'fungalaxy', `${p}-carte.webp`)).size : -1 }))
    .filter((x) => x.o < 0 || x.o > POIDS_PHOTO_MAX);
  ok(lourdes.length === 0, `chaque photo de carte existe dans le depot et pese au plus ${POIDS_PHOTO_MAX / 1024} Ko`, lourdes.map((x) => `${x.p} ${x.o < 0 ? 'absente' : `${(x.o / 1024).toFixed(1)} Ko`}`).join(' '));
}
function verifierTaille(mesures, familles, largeur) {
  section(`C. LA CARTE GARDE SA TAILLE (${largeur} px)`);
  const ecarts = mesures.filter((m) => Math.abs(m.h - m.sans) > 0.5);
  ok(mesures.length > 0 && ecarts.length === 0, 'retirer la photo ne change la hauteur d aucune carte', ecarts.map((m) => `${m.id} ${m.h.toFixed(1)} contre ${m.sans.toFixed(1)}`).join(' ') || `${mesures.length} cartes`);
  const poses = familles.flatMap((f) => f.cartes).filter((c) => c.photoPose && c.photoVue);
  ok(poses.length > 0 && poses.every((c) => c.photoPose.position === 'absolute' && c.photoPose.couvre), 'la photo est posee en fond et couvre toute la carte', poses.filter((c) => !(c.photoPose.position === 'absolute' && c.photoPose.couvre)).map((c) => `${c.id} ${c.photoPose.position}`).join(' '));
}
function verifierTexte(familles, largeur) {
  section(`D. LE TEXTE DEVANT LA PHOTO (${largeur} px)`);
  const poses = familles.flatMap((f) => f.cartes).filter((c) => c.photoPose && c.photoVue);
  ok(poses.length > 0 && poses.every((c) => c.texteZ && c.texteZ.position === 'relative' && Number(c.texteZ.z) > Number(c.photoPose.z)), 'le texte passe devant la photo', poses.map((c) => `${c.id} ${c.texteZ && c.texteZ.z}>${c.photoPose.z}`).join(' '));
  const clairs = poses.filter((c) => !(c.voileMin >= 0.74));
  ok(clairs.length === 0, 'le voile noir couvre la photo a 74 % au moins, partout (plus sombre pour mieux voir les textes)', clairs.map((c) => `${c.id} ${c.voileMin}`).join(' ') || `voile le plus clair ${Math.min(...poses.map((c) => c.voileMin))}`);
}
function verifierRemise(familles, meta, largeur) {
  section(`E. LA REMISE DES OFFRES SPECIALES (${largeur} px)`);
  const parId = Object.fromEntries((meta.formules || []).map((f) => [f.id, f]));
  const anniv = familles.find((f) => /anniv/i.test(f.titre));
  const speciales = familles.filter((f) => f !== anniv).flatMap((f) => f.cartes);
  const attendue = (f) => (Number(f.price) > 0 && Number(f.oldPrice) > Number(f.price) ? `-${Math.round((1 - Number(f.price) / Number(f.oldPrice)) * 100)} %` : '');
  const avec = speciales.filter((c) => attendue(parId[c.id] || {}));
  ok(avec.length > 0 && speciales.length > avec.length, 'MONTAGE des offres speciales avec et sans ancien prix sont affichees', `${avec.length} avec, ${speciales.length - avec.length} sans`);
  const faux = speciales.filter((c) => sansEspaces(c.remise) !== attendue(parId[c.id] || {}));
  ok(faux.length === 0, 'une offre speciale dit sa remise au pourcent pres, et rien sans ancien prix', faux.map((c) => `${c.id} « ${sansEspaces(c.remise)} » au lieu de « ${attendue(parId[c.id] || {})} »`).join(' ; ') || speciales.map((c) => `${c.id} ${sansEspaces(c.remise) || '-'}`).join(' '));
  ok(anniv && anniv.cartes.length > 0 && anniv.cartes.every((c) => !c.remise), 'un anniversaire ne porte jamais de remise', anniv ? anniv.cartes.filter((c) => c.remise).map((c) => c.id).join(' ') : '');
}
function verifierDebord(familles, page, largeur, scroll) {
  section(`H. RIEN NE DEBORDE (${largeur} px)`);
  const dehors = familles.flatMap((f) => f.cartes).filter((c) => c.debord);
  ok(scroll <= largeur + 1 && dehors.length === 0, 'ni la page ni une carte ne debordent', `largeur de page ${scroll} px ; ${dehors.map((c) => c.id).join(' ')}`);
}

async function parcoursComplet(browser, mock, largeur, meta, { seulement } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 }, deviceScaleFactor: 1, locale: 'fr-BE', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message)));
  try {
    if (!ok(await versFormules(page, mock.DATE, 10), `MONTAGE l onglet des formules s ouvre (${largeur} px)`)) return;
    const familles = await lireCartes(page);
    const a = (k) => !seulement || seulement.includes(k);
    if (a('A')) verifierFete(familles, largeur);
    if (a('B')) verifierPhotos(familles, largeur);
    if (a('C')) verifierTaille(await hauteursSansPhoto(page), familles, largeur);
    if (a('D')) verifierTexte(familles, largeur);
    if (a('E')) verifierRemise(familles, meta, largeur);
    if (a('H')) verifierDebord(familles, page, largeur, await page.evaluate(() => document.documentElement.scrollWidth));
    if (!seulement) ok(erreurs.length === 0, `aucune erreur JavaScript (${largeur} px)`, erreurs[0]);
  } finally {
    await ctx.close();
  }
}

async function verifierChargement(browser, mock) {
  section('F. LES PHOTOS NE SE CHARGENT QU A L OUVERTURE DES FORMULES');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-BE' });
  const page = await ctx.newPage();
  const vues = [];
  page.on('request', (r) => { if (/-carte\.webp/.test(r.url())) vues.push(r.url()); });
  try {
    if (!ok(await versFormules(page, mock.DATE, 10, { ouvrir: false }), 'MONTAGE l ecran des activites est ouvert')) return;
    await page.waitForTimeout(800);
    const avant = vues.length;
    await page.click('#tabFor');
    await attendre(page, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-for__photo img').length > 0, 5000);
    await attendre(page, () => Array.from(document.querySelectorAll('#gridFor .fg-for__photo img')).some((i) => i.complete && i.naturalWidth > 0), 8000);
    ok(avant === 0 && vues.length > 0, 'aucune photo de carte avant l onglet des formules ; elles arrivent a son ouverture', `${avant} avant, ${vues.length} apres`);
  } finally {
    await ctx.close();
  }
}

async function verifierAutreCentre(browser, mock) {
  section('G. UN AUTRE CENTRE NE RECOIT AUCUNE PHOTO DE LIBRAMONT');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-BE' });
  // Le meme catalogue, servi pour un centre sans photos.
  await ctx.route('**/api/public-booking-meta?**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const r = await route.fetch();
    const j = await r.json();
    if (j && j.center) j.center.id = 'ciney';
    return route.fulfill({ response: r, json: j });
  });
  const page = await ctx.newPage();
  try {
    if (!ok(await versFormules(page, mock.DATE, 10), 'MONTAGE l onglet des formules s ouvre pour un centre sans photos')) return;
    const lu = await page.evaluate(() => ({
      cartes: document.querySelectorAll('#gridFor .fg-card--formule').length,
      photos: document.querySelectorAll('#gridFor .fg-for__photo').length,
      fete: document.querySelectorAll('#gridFor .fg-card--formule.is-fete').length,
    }));
    ok(lu.cartes > 0 && lu.photos === 0, 'aucune carte ne prend une photo d un autre centre', `${lu.cartes} cartes, ${lu.photos} photos`);
    ok(lu.fete > 0, 'la guirlande des anniversaires reste, elle ne tient pas aux photos', `${lu.fete} cartes en fete`);
  } finally {
    await ctx.close();
  }
}

async function verifierFeries(browser, mock) {
  section('I. « JOURS FÉRIÉS » AVEC SES ACCENTS');
  const meta = await lireMeta();
  const anniv = (meta.formules || []).filter((f) => /^f[1-8]$/.test(String(f.id)));
  const notes = (meta.formules || []).flatMap((f) => f.notes || []);
  ok(anniv.length === 8 && anniv.every((f) => (f.notes || []).some((n) => /jours fériés/.test(n))) && !notes.some((n) => /jours feries/.test(n)), 'le catalogue servi ecrit « jours fériés », jamais « jours feries »',
    `${anniv.filter((f) => (f.notes || []).some((n) => /jours fériés/.test(n))).length}/8 ; sans accents : ${notes.filter((n) => /jours feries/.test(n)).length}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-BE' });
  const page = await ctx.newPage();
  try {
    if (!ok(await versFormules(page, mock.DATE, 10), 'MONTAGE l onglet des formules s ouvre')) return;
    await page.click('#gridFor li:has([data-formule="f1"]) [data-formula-info]');
    const ouverte = await attendre(page, () => { const d = document.querySelector('dialog[open]'); return d && d.querySelector('.fg-info-text').textContent.trim().length > 0; }, 6000);
    const texte = ouverte ? await page.evaluate(() => document.querySelector('dialog[open] .fg-info-text').textContent) : '';
    ok(ouverte && /jours fériés/.test(texte) && !/jours feries/.test(texte), 'la fiche de la Formule 1 dit « jours fériés »', ouverte ? '' : 'fiche fermee');
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// [J] CONTRE-EPREUVES, servies en memoire
// ---------------------------------------------------------------------------
async function contreEpreuve(nom, label, fn) {
  if (!ok(ancreUnique(nom), `contre-epreuve montable : ${nom}`)) return;
  mutation = nom;
  muet = true;
  rouges = 0;
  try { await fn(); } catch (e) { rouges += 1; }
  muet = false;
  mutation = '';
  ok(rouges > 0, `${label} : ce gate ROUGIRAIT`, `${rouges} rouge(s)`);
}
async function contreEpreuves(browser, mock, meta) {
  section('J. CONTRE-EPREUVES');
  const empreintes = ['fungalaxy-booking.js', 'fungalaxy-booking.css'].map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'));
  await contreEpreuve('fete', 'sans la famille des anniversaires reconnue, la guirlande disparait', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['A'] }));
  await contreEpreuve('festonCoupe', 'repetee sans « round », la guirlande coupe un feston au bord', () => parcoursComplet(browser, mock, 1440, meta, { seulement: ['A'] }));
  await contreEpreuve('repete', 'sans la seconde photo, une section montre deux fois la meme', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['B'] }));
  await contreEpreuve('refusAvecPhoto', 'une formule refusee qui garde sa photo', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['B'] }));
  await contreEpreuve('dansLeFlux', 'la photo posee dans le flux rallonge la carte', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['C'] }));
  await contreEpreuve('voileClair', 'un voile plus clair', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['D'] }));
  await contreEpreuve('remiseAnniv', 'la remise posee aussi sur les anniversaires', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['E'] }));
  await contreEpreuve('remiseFausse', 'une remise mal calculee', () => parcoursComplet(browser, mock, 390, meta, { seulement: ['E'] }));
  await contreEpreuve('tot', 'des photos chargees des l arrivee', () => verifierChargement(browser, mock));
  await contreEpreuve('partout', 'les photos de Libramont donnees a tous les centres', () => verifierAutreCentre(browser, mock));
  await contreEpreuve('feries', 'un catalogue qui ecrit « jours feries »', () => verifierFeries(browser, mock));
  const apres = ['fungalaxy-booking.js', 'fungalaxy-booking.css'].map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'));
  ok(apres[0] === empreintes[0] && apres[1] === empreintes[1], 'le depot n a jamais ete touche');
}

async function main() {
  const mock = require('./dev-tunnel-server');
  const { chromium } = require('playwright-core');
  const srv = await serveur(mock);
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    const meta = await lireMeta();
    if (!ok(Array.isArray(meta.formules) && meta.formules.length > 0, 'MONTAGE le catalogue public est servi')) throw new Error('catalogue');
    for (const largeur of [390, 1440, 320]) await parcoursComplet(browser, mock, largeur, meta, largeur === 320 ? { seulement: ['C', 'H'] } : {});
    await verifierChargement(browser, mock);
    await verifierAutreCentre(browser, mock);
    await verifierFeries(browser, mock);
    if (!process.argv.includes('--sans-contre-epreuves')) await contreEpreuves(browser, mock, meta);
  } catch (error) {
    ok(false, `exception : ${error && error.message}`);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${echecs === 0 ? 'formules-fete-check: ALL OK' : `formules-fete-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
