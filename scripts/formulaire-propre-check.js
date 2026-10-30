// LE FORMULAIRE RESTE PROPRE SUR UN PETIT ECRAN ET CHEZ N IMPORTE QUEL HOTE
// (2026-10-12). Movsar : « ya des bugs visuels un peu partout et tout n est
// pas clean ». Le balayage du formulaire a 360, 390, 800 et 1280 px, seul et
// dans le cadre d une page hote, a montre trois defauts, chacun regle par une
// regle que ce gate asserte :
//
// [A] LE FOND DE L HOTE N EST REPRIS QUE S IL EST SOMBRE. Le cadre prend la
//     couleur du site pour s y fondre ; sur une page au fond blanc, le
//     recapitulatif, ecrit en blanc, devenait illisible. Un hote clair garde le
//     noir du formulaire ; un hote sombre est repris tel quel.
// [B] LES MOTS QUI NE SE SEPARENT PAS. A 360 px, « 2 » finissait une ligne et
//     « pistes » ouvrait la suivante, un « × » ou un « = » pendait, « / »
//     precedait « personne ». Dans les prix et notes des cartes, la ligne de
//     chaque etape et la note des pistes : aucun espace secable entre un nombre
//     et son unite, avant un « · », apres un « × » ou un « = », autour d un
//     « / » ; le calcul des pistes se lit d un bloc.
// [C] LE PROGRAMME N A NI FIL NI POINT (Movsar, 2026-10-13 : « le point qui
//     clignote a cote du logo horloge c est typique IA »). Le fil vertical qui
//     reliait les lignes et le point de chaque ligne sont partis, et avec eux
//     le defaut du 2026-10-12 (sur telephone, le fil traversait l etape
//     ouverte). A 360 px comme a 1280 px : la liste ne dessine aucun fil,
//     aucune ligne n a de point, et l icone ouvre chaque ligne.
// [D] LA GRILLE DES ACTIVITES SUIT LA FENETRE. Passee de 4 colonnes a 2
//     (telephone qu on tourne, fenetre qu on retrecit), elle gardait ses
//     colonnes 3 et 4 : le placement les recomptait dans les colonnes
//     calculees, ou figurent aussi les colonnes implicites qu il avait creees,
//     les deux vraies tombaient a 0 px et les cartes s empilaient. Apres
//     1440 > 1024 > 375 px, puis retour a 1440, la grille a les colonnes d une
//     page ouverte directement a cette largeur, sans colonne implicite, et
//     aucune carte n en chevauche une autre.
//
// CONTRE-EPREUVE (--mutate) : chaque regle est retiree EN MEMOIRE au moment ou
// le fichier est servi, et le gate doit rougir. Le disque n est jamais ecrit,
// et on le verifie.
//
// Lancement : node scripts/formulaire-propre-check.js [--mutate]
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Le noir du formulaire : le jeton --fg-bg de SA feuille, lu a la source. Le
// gate juge la regle (sur un hote clair, le cadre garde ce noir, assez sombre
// pour son texte blanc), pas une valeur recopiee qui rougit au premier
// changement de teinte (la passe premium du 2026-10-14 l a vu).
const NOIR_FORMULAIRE = ((/--fg-bg:\s*(#[0-9a-fA-F]{6})\s*;/.exec(fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.css'), 'utf8')) || [])[1] || '').toLowerCase();
const rgbDe = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const PORT = Number(process.env.PINLANE_PROPRE_PORT || 4473);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);
const NBSP = String.fromCharCode(160);

const MUTATIONS = [
  { nom: 'le fond de l hote est repris meme clair', fichier: 'assets/fungalaxy-booking.js', de: ' && fondAssezSombre(fond)) {', vers: ') {' },
  { nom: 'typo() ne soude plus rien', fichier: 'assets/fungalaxy-booking.js', de: "  function typo(s) {\n    return String(s == null ? '' : s)\n", vers: "  function typo(s) {\n    return String(s == null ? '' : s); return String(s)\n" },
  { nom: 'le calcul des pistes ne se tient plus d un bloc', fichier: 'assets/fungalaxy-booking.css', de: '.fg-calcul { display: inline-block; }\n', vers: '' },
  { nom: 'le fil du programme revient', fichier: 'assets/fungalaxy-booking.css', de: '.fg-etape { position: relative; }\n', vers: '.fg-etapes::before { content: ""; position: absolute; left: 28px; top: 30px; bottom: 30px; width: 2px; background: rgba(255, 255, 255, 0.09); }\n.fg-etape { position: relative; }\n' },
  { nom: 'le point revient devant l icone de chaque ligne', fichier: 'assets/fungalaxy-booking.js', de: "      + '<span class=\"fg-etape__icone\">", vers: "      + '<span class=\"fg-etape__point\" aria-hidden=\"true\"></span><span class=\"fg-etape__icone\">" },
  { nom: 'la grille des activites recompte ses colonnes sans retirer ses placements', fichier: 'assets/fungalaxy-booking.js', de: "        tuiles.forEach(function (tile) { tile.style.gridColumn = ''; tile.style.gridRow = ''; });\n", vers: '' },
];
const MUTATION_PREUVE = '[mutation] servie en memoire :';
const MUTATION_ACTIVE = Number(process.env.PINLANE_PROPRE_MUTATION || 0);
const MUTATION = MUTATION_ACTIVE ? MUTATIONS[MUTATION_ACTIVE - 1] : null;
function muter(contenu, mutation) {
  const texte = contenu.split(CRLF).join(LF);
  if (texte.split(mutation.de).length - 1 !== 1) {
    console.error(`mutation impossible : ancre absente ou multiple dans ${mutation.fichier} : ${mutation.de.slice(0, 70)}`);
    process.exit(2);
  }
  console.log(`${MUTATION_PREUVE} ${mutation.nom}`);
  return texte.split(mutation.de).join(mutation.vers);
}

for (const nom of Object.keys(process.env)) if (/(^PG|DATABASE|POSTGRES|RESEND|SECRET|TOKEN|API_KEY|PASSWORD|PASSPHRASE)/i.test(nom)) delete process.env[nom];
process.env.PINLANE_DEVTUNNEL_PORT = String(PORT);
const mock = require('./dev-tunnel-server');
const { chromium } = require('playwright-core');

let failures = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}${detail !== undefined && detail !== '' ? `  ${detail}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch (error) { return Boolean(await page.evaluate(fn, arg).catch(() => false)); }
}

const hote = (fond) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hote</title><style>body{margin:0;background:${fond};font-family:sans-serif}header{height:64px;background:#ddd}#slot{max-width:1440px;margin:0 auto;padding:24px 0 60px}</style></head><body><header></header><div id="slot"></div><script src="/embed.js" data-center="libramont" data-design="fungalaxy" data-target="#slot" data-height="720"></script></body></html>`;

function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/hote-blanc.html' || url.pathname === '/hote-sombre.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(hote(url.pathname === '/hote-blanc.html' ? '#ffffff' : '#111111'));
      return;
    }
    if (MUTATION && url.pathname === `/${MUTATION.fichier}`) {
      const source = fs.readFileSync(path.join(ROOT, MUTATION.fichier), 'utf8');
      res.writeHead(200, { 'Content-Type': `${MUTATION.fichier.endsWith('.css') ? 'text/css' : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(muter(source, MUTATION));
      return;
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// Les coupures interdites, en ESPACES ORDINAIRES : nombre puis unite, espace
// avant « · », apres « × » ou « = », autour de « / ».
function coupures(texte) {
  const s = String(texte || '');
  const fautes = [];
  const unite = /(\d) (€|min|h|heures?|pistes?|joueurs?|parties?|personnes?|places?|enfants?|tables?)(?![A-Za-zÀ-ÿ])/g;
  let m;
  while ((m = unite.exec(s))) fautes.push(`« ${m[1]} ${m[2]} »`);
  if (/ ·/.test(s)) fautes.push('espace avant « · »');
  if (/[×=] /.test(s)) fautes.push('espace apres « × » ou « = »');
  if (/ \/ /.test(s)) fautes.push('espaces autour de « / »');
  return fautes;
}

async function cadreDe(page) {
  await page.waitForSelector('iframe', { timeout: 30000 });
  const cadre = await (await page.$('iframe')).contentFrame();
  await cadre.waitForLoadState('load');
  await attendre(cadre, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 30000);
  return cadre;
}

async function verifierHotes(browser) {
  console.log('\n[A] LE FOND DE L HOTE N EST REPRIS QUE S IL EST SOMBRE');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const lire = async (adresse) => {
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}${adresse}`, { waitUntil: 'load', timeout: 45000 });
      const cadre = await cadreDe(page);
      const lu = await cadre.evaluate(() => ({
        fond: new URLSearchParams(location.search).get('fond') || '',
        corps: getComputedStyle(document.body).backgroundColor,
        ref: getComputedStyle(document.documentElement).getPropertyValue('--fg-bg').trim(),
      }));
      await page.close();
      return lu;
    };
    const blanc = await lire('/hote-blanc.html');
    ok(/255, 255, 255/.test(blanc.fond), '[A] MONTAGE : l hote blanc envoie bien sa couleur au cadre', JSON.stringify(blanc));
    ok(/^#[0-9a-f]{6}$/.test(NOIR_FORMULAIRE) && luminance(NOIR_FORMULAIRE) < 0.02 && blanc.corps === rgbDe(NOIR_FORMULAIRE) && blanc.ref.toLowerCase() === NOIR_FORMULAIRE, '[A] hote blanc : le cadre garde le noir du formulaire (texte blanc lisible)', JSON.stringify({ ...blanc, noir: NOIR_FORMULAIRE }));
    const sombre = await lire('/hote-sombre.html');
    ok(/17, 17, 17/.test(sombre.fond) && sombre.corps === 'rgb(17, 17, 17)' && /17, 17, 17/.test(sombre.ref), '[A] hote sombre : le cadre se fond dans sa couleur', JSON.stringify(sombre));
  } finally { await ctx.close(); }
}

async function verifierPetitEcran(browser) {
  console.log('\n[B] LES MOTS QUI NE SE SEPARENT PAS, et [C] NI FIL NI POINT SUR LE PROGRAMME, A 360 PX');
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  try {
    await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'load', timeout: 45000 });
    ok(await attendre(page, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 30000), '[B] MONTAGE : le formulaire est pret');
    await page.click('#dayBtn');
    for (let i = 0; i < 3 && !(await page.$(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]:not([disabled])`)); i += 1) await page.click('#calNext');
    await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await page.fill('#paxInput', '10');
    await page.dispatchEvent('#paxInput', 'change');
    await page.click('#goActivities');
    ok(await attendre(page, () => { const s = document.querySelector('.fg-scene[data-scene="activites"]'); return s && s.classList.contains('is-active') && document.querySelectorAll('#gridAct .fg-card').length > 0; }, 30000), '[B] MONTAGE : les cartes des activites sont rendues');
    for (const id of ['bowling', 'laser_game']) {
      await page.evaluate((x) => document.querySelector(`#gridAct .fg-card[data-activity="${x}"]`).click(), id);
      await attendre(page, (x) => document.querySelector(`#gridAct li[data-activity="${x}"]`).classList.contains('is-on'), 10000, id);
    }
    await page.waitForTimeout(500);
    const cartes = await page.evaluate(() => Array.from(document.querySelectorAll('#gridAct .fg-card__price, #gridAct .fg-card__rot'))
      .filter((n) => n.textContent.trim()).map((n) => ({ ou: (n.closest('[data-activity]') || {}).dataset ? n.closest('[data-activity]').dataset.activity + ' ' + n.className : n.className, texte: n.textContent })));
    const fautesCartes = cartes.map((c) => ({ ou: c.ou, fautes: coupures(c.texte), texte: c.texte })).filter((c) => c.fautes.length);
    ok(cartes.length >= 6, '[B] MONTAGE : prix et notes des cartes lus', String(cartes.length));
    ok(fautesCartes.length === 0, '[B] cartes : aucun nombre separe de son unite, aucun « · », « × », « = » ou « / » pendu', JSON.stringify(fautesCartes.slice(0, 4)));
    ok(cartes.some((c) => c.texte.indexOf(`2${NBSP}pistes`) >= 0) && cartes.some((c) => c.texte.indexOf(`${NBSP}/${NBSP}`) >= 0), '[B] MONTAGE : les cartes portent bien un « 2 pistes » et un « / » (la regle a de quoi mordre)', JSON.stringify(cartes.map((c) => c.texte).slice(0, 6)));

    await page.click('#goHours');
    ok(await attendre(page, () => { const z = document.querySelector('#hourZone'); return z && z.querySelector('.fg-chip') && !z.classList.contains('is-busy') && !z.querySelector('.fg-skel'); }, 60000), '[B] MONTAGE : l ecran des heures est rendu');
    await page.waitForTimeout(700);
    const heures = await page.evaluate(() => ({
      etapes: Array.from(document.querySelectorAll('#hourZone .fg-etape__quoi small')).map((n) => n.textContent).filter(Boolean),
      pistes: (document.querySelector('#hourZone .fg-track__lanes') || {}).textContent || '',
      calcul: (() => { const c = document.querySelector('#hourZone .fg-track__lanes .fg-calcul'); return c ? getComputedStyle(c).display : ''; })(),
    }));
    const fautesHeures = heures.etapes.concat([heures.pistes]).map((t) => ({ t, fautes: coupures(t) })).filter((x) => x.fautes.length);
    ok(heures.etapes.length >= 2 && Boolean(heures.pistes), '[B] MONTAGE : la ligne de chaque etape et la note des pistes sont lues', JSON.stringify(heures));
    ok(fautesHeures.length === 0, '[B] heures : la ligne des etapes et la note des pistes ne se coupent pas au mauvais endroit', JSON.stringify(fautesHeures));
    ok(heures.calcul === 'inline-block', '[B] le calcul des pistes (10 joueurs = 2 pistes × 39 € = 78 €) se tient d un bloc', heures.calcul);

    // Le fil se lit sur le pseudo-element de la liste ; le point, sur la
    // ligne elle-meme : l icone en est le premier element peint, au ras de
    // son retrait.
    const sansFil = () => page.evaluate(() => {
      const liste = document.querySelector('#hourZone .fg-etapes');
      if (!liste) return null;
      const tetes = Array.from(document.querySelectorAll('#hourZone .fg-etape__tete'));
      return {
        fil: getComputedStyle(liste, '::before').content,
        points: document.querySelectorAll('#hourZone .fg-etape__point').length,
        lignes: tetes.length,
        decalees: tetes.filter((t) => {
          const i = t.querySelector('.fg-etape__icone');
          return !i || Math.abs(i.getBoundingClientRect().left - t.getBoundingClientRect().left - parseFloat(getComputedStyle(t).paddingLeft)) > 1;
        }).length,
      };
    });
    const etroit = await sansFil();
    ok(Boolean(etroit) && etroit.lignes >= 2 && etroit.fil === 'none' && etroit.points === 0 && etroit.decalees === 0, '[C] a 360 px, le programme n a ni fil ni point : l icone ouvre chaque ligne', JSON.stringify(etroit));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    const large = await sansFil();
    ok(Boolean(large) && large.lignes >= 2 && large.fil === 'none' && large.points === 0 && large.decalees === 0, '[C] a 1280 px non plus, ni fil ni point', JSON.stringify(large));
    ok(erreurs.length === 0, '[B] aucune erreur de page', erreurs.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

async function versActivites(page) {
  await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'load', timeout: 45000 });
  await attendre(page, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 30000);
  await page.click('#dayBtn');
  for (let i = 0; i < 3 && !(await page.$(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]:not([disabled])`)); i += 1) await page.click('#calNext');
  await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
  await page.click('#goActivities');
  const pret = await attendre(page, () => { const s = document.querySelector('.fg-scene[data-scene="activites"]'); return s && s.classList.contains('is-active') && document.querySelectorAll('#gridAct .fg-card').length > 0; }, 30000);
  for (const id of ['bowling', 'laser_game']) {
    await page.evaluate((x) => document.querySelector(`#gridAct .fg-card[data-activity="${x}"]`).click(), id);
    await attendre(page, (x) => document.querySelector(`#gridAct li[data-activity="${x}"]`).classList.contains('is-on'), 10000, id);
  }
  return pret;
}

// La grille posee : ses colonnes vues (abscisses des cartes), ses colonnes
// calculees (implicites comprises), la largeur des cartes et leurs
// chevauchements. Lue au repos (tiroirs ouverts, placement refait).
async function lireGrille(page) {
  await page.waitForTimeout(400);
  await attendre(page, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 8000);
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const g = document.querySelector('#gridAct');
    const rects = Array.from(g.children).filter((x) => x.classList.contains('fg-grid__item')).map((li) => { const r = li.getBoundingClientRect(); return { id: li.dataset.activity, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
    const chevauchements = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i], b = rects[j];
        if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1) chevauchements.push(`${a.id}/${b.id}`);
      }
    }
    return { n: rects.length, colonnes: new Set(rects.map((r) => r.x)).size, calculees: getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length, largeurs: rects.map((r) => r.w), chevauchements };
  });
}

async function verifierGrille(browser) {
  console.log('\n[D] LA GRILLE DES ACTIVITES SUIT LA FENETRE');
  const temoin = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    try { const page = await ctx.newPage(); await versActivites(page); return await lireGrille(page); } finally { await ctx.close(); }
  };
  const etroit = await temoin(375, 812);
  const large = await temoin(1440, 900);
  ok(etroit.n >= 6 && large.n === etroit.n && etroit.colonnes === etroit.calculees && large.colonnes === large.calculees && large.colonnes > etroit.colonnes && Math.min(...etroit.largeurs) >= 100,
    '[D] MONTAGE : ouverte directement, la grille a ses colonnes (375 px et 1440 px) et des cartes lisibles', JSON.stringify({ etroit: [etroit.colonnes, etroit.calculees], large: [large.colonnes, large.calculees], min: Math.min(...etroit.largeurs) }));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  try {
    ok(await versActivites(page), '[D] MONTAGE : a 1440 px, bowling et laser coches, tiroirs ouverts');
    await lireGrille(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await lireGrille(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const apres = await lireGrille(page);
    const ecarts = apres.largeurs.filter((w, i) => Math.abs(w - etroit.largeurs[i]) > 2);
    ok(apres.colonnes === etroit.colonnes && apres.calculees === etroit.calculees && ecarts.length === 0 && apres.chevauchements.length === 0,
      '[D] retrecie de 1440 a 375 px, la grille a les colonnes d une page ouverte a 375 px, aucune colonne implicite, aucune carte sur une autre',
      JSON.stringify({ colonnes: apres.colonnes, calculees: apres.calculees, attendu: etroit.colonnes, largeurs: apres.largeurs, chevauchements: apres.chevauchements.slice(0, 3) }));
    await page.setViewportSize({ width: 1440, height: 900 });
    const retour = await lireGrille(page);
    ok(retour.colonnes === large.colonnes && retour.calculees === large.calculees && retour.chevauchements.length === 0,
      '[D] rendue a 1440 px, la grille retrouve ses colonnes',
      JSON.stringify({ colonnes: retour.colonnes, calculees: retour.calculees, attendu: large.colonnes, chevauchements: retour.chevauchements.slice(0, 3) }));
    ok(erreurs.length === 0, '[D] aucune erreur de page', erreurs.slice(0, 3).join(' | '));
  } finally { await ctx.close(); }
}

async function main() {
  const server = await serveur();
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
    await verifierHotes(browser);
    await verifierPetitEcran(browser);
    await verifierGrille(browser);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  if (failures) {
    console.error(`\nformulaire-propre-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nformulaire-propre-check: ALL OK (fond d hote sombre seulement, mots insecables, ni fil ni point sur le programme, grille des activites qui suit la fenetre)');
  process.exit(0);
}

if (process.argv.includes('--mutate')) {
  const empreintes = new Map(MUTATIONS.map((m) => [m.fichier, fs.readFileSync(path.join(ROOT, m.fichier), 'utf8')]));
  // Les mutations se jouaient une par une (spawnSync) ; un pool de fils
  // (PINLANE_ECLATS, defaut 6), chacun sur son port, rend les MEMES verdicts,
  // imprimes dans l ordre des mutations (2026-10-19).
  const eclats = require('./gates-eclats');
  eclats.enPool(MUTATIONS, eclats.nombreDeFils(MUTATIONS.length), (m, fil, i) => eclats.lancer(__filename, [], { env: { ...process.env, PINLANE_PROPRE_PORT: String(PORT + 1 + fil), PINLANE_PROPRE_MUTATION: String(i + 1) } })).then((runs) => {
  let ratees = 0;
  MUTATIONS.forEach((mutation, index) => {
    const run = runs[index];
    const sortie = `${run.stdout || ''}${run.stderr || ''}`;
    const mordu = sortie.includes(`${MUTATION_PREUVE} ${mutation.nom}`);
    if (run.status === 1 && mordu) console.log(`contre-epreuve OK : le gate rougit quand ${mutation.nom}.`);
    else { ratees += 1; console.log(sortie); console.log(`CONTRE-EPREUVE RATEE (code ${run.status}, mutation ${mordu ? 'servie' : 'JAMAIS servie'}) : ${mutation.nom}.`); }
  });
  const touches = [...empreintes].filter(([fichier, avant]) => fs.readFileSync(path.join(ROOT, fichier), 'utf8') !== avant).map(([fichier]) => fichier);
  if (touches.length) { console.log(`LE DISQUE A ETE ECRIT : ${touches.join(', ')}`); ratees += 1; }
  if (ratees) process.exit(1);
  console.log(`contre-epreuve OK : ${MUTATIONS.length} mutations, et aucun fichier n a ete ecrit.`);
  });
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}
