// LA RECHERCHE NE GRISE PLUS LE PLANNING EN SILENCE (2026-11-07).
//
// Ansar, capture du planning bowling : « pourquoi y en a ils sont transparents ».
// La recherche et le filtre grisent les groupes qui ne leur correspondent pas
// (choix du 2026-10-27 : griser, jamais cacher, pour qu une piste prise ne se dise
// jamais libre). Mais la recherche etait enregistree avec tout l etat du poste et
// revenait au rechargement : un nom tape la veille grisait le planning du
// lendemain, et rien sous la barre ne disait pourquoi.
//
//   [A] UNE RECHERCHE ENREGISTREE NE REVIENT PAS AU DEMARRAGE. Le poste a garde
//       « Wilmotte » : la console demarre sans recherche. Lu a DOMContentLoaded,
//       avant que le banc ne remette lui-meme l etat a zero (il le fait a load).
//   [B] AU BOWLING, LA RECHERCHE SE DIT SOUS LA BARRE : « Recherche « Wilmotte » :
//       1 groupe sur N », avec « Tout afficher ». Le compte est celui de la
//       grille : les groupes nets sont ceux que la ligne annonce.
//   [C] « TOUT AFFICHER » REND TOUTE LA JOURNEE : recherche ET filtre enleves,
//       plus aucune carte grisee, la ligne disparait.
//   [D] AU LASER AUSSI, avec la regle du laser (nom, telephone, adresse, numero).
//   [E] A LA TABLETTE (1024 px), le texte et le bouton tiennent dans la ligne.
//   [F] aucune erreur JS.
// --contre-preuves : chaque regle retiree (au code servi ; le disque n est jamais
// touche) fait rougir sa lettre.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_PLANNING_RECHERCHE_PORT || 5241);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const JS = 'assets/app-main.js';
const GJS = 'assets/pinlane-planning-global.js';
const CSS = 'assets/pinlane-planning-global.css';
const CLE_POSTE = 'funGalaxy_v4';

let echecs = 0;
let silence = false;
const rouges = [];
class Mordu extends Error {}
let mutation = null;
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!cond && mutation && label.startsWith(`[${mutation.lettre}]`)) throw new Mordu(label);
  return cond;
}
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

// Ce que la ligne sous la barre dit, et ce que la grille montre.
async function lire(page, grille) {
  return page.evaluate((g) => {
    const bande = document.getElementById('planningBande');
    const texte = bande && bande.querySelector('.pb-recherche');
    const bouton = bande && bande.querySelector('[data-pb-tout]');
    const cartes = [...document.querySelectorAll(g.carte)];
    const id = (c) => c.getAttribute(g.attribut);
    const tous = new Set(cartes.map(id));
    const nets = new Set(cartes.filter((c) => !c.classList.contains('is-grise')).map(id));
    const boite = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    return {
      texte: texte ? texte.textContent.replace(/\s+/g, ' ').trim() : '',
      bouton: bouton ? bouton.textContent.trim() : '',
      boites: { bande: boite(bande), texte: boite(texte), bouton: boite(bouton) },
      tous: tous.size,
      nets: nets.size,
      grisees: cartes.filter((c) => c.classList.contains('is-grise')).length,
      nomsNets: cartes.filter((c) => !c.classList.contains('is-grise')).map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
      terme: state.searchTerm,
      champ: (document.getElementById('globalPlanningSearchInput') || {}).value,
      filtre: state.staffStatusFilter,
    };
  }, grille);
}
const BOWLING = { carte: '#planningGridWrap .booking[data-booking-res-id]', attribut: 'data-booking-res-id' };
const LASER = { carte: '#laserPlanningGridWrap .lp-g[data-laser-res-id]', attribut: 'data-laser-res-id' };

async function vue(page, nom) {
  await page.evaluate((v) => pbChanger(v), nom);
  await FX.repos(page, 300);
}
async function chercher(page, mot) {
  await page.fill('#globalPlanningSearchInput', mot);
  await page.waitForFunction((m) => state.searchTerm === m, mot);
  await FX.repos(page, 300);
}

async function scenarioDemarrage(browser) {
  const { ctx, page, erreurs } = await FX.monter(browser, {
    fixture: 'normal', appareil: 'ordinateur', theme: 'light', port: PORT,
    // (a chaque chargement : ce que vaut la recherche juste apres le code de la
    // console, avant le banc)
    avantChargement: (p) => p.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        try { window.__rechercheAuDemarrage = state.searchTerm; } catch (e) { window.__rechercheAuDemarrage = `illisible : ${e.message}`; }
      });
    }),
  });
  try {
    const garde = await page.evaluate((cle) => {
      const brut = JSON.parse(localStorage.getItem(cle) || 'null');
      if (!brut) return null;
      brut.searchTerm = 'Wilmotte';
      localStorage.setItem(cle, JSON.stringify(brut));
      return JSON.parse(localStorage.getItem(cle)).searchTerm;
    }, CLE_POSTE);
    ok(garde === 'Wilmotte', '[A] prerequis : le poste garde « Wilmotte » dans son etat enregistre', garde);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fixturePrete === true, null, { timeout: 60000 });
    const auDemarrage = await page.evaluate(() => window.__rechercheAuDemarrage);
    ok(auDemarrage === '', '[A] la recherche enregistree ne revient pas au demarrage', auDemarrage);
    ok(!erreurs.length, '[F] aucune erreur JS (demarrage)', erreurs);
  } finally { await ctx.close(); }
}

async function scenarioBowling(browser) {
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'normal', appareil: 'ordinateur', theme: 'light', port: PORT });
  try {
    await vue(page, 'bowling');
    const avant = await lire(page, BOWLING);
    ok(avant.tous >= 3 && avant.grisees === 0 && !avant.texte, '[B] prerequis : plusieurs groupes au bowling, aucun grise, aucune ligne de recherche', avant);
    await chercher(page, 'Wilmotte');
    const pendant = await lire(page, BOWLING);
    ok(pendant.nets === 1 && pendant.nomsNets.every((n) => /Wilmotte/.test(n)) && pendant.grisees > 0, '[B] prerequis : seul Wilmotte reste net, les autres sont grises', pendant);
    ok(pendant.texte === `Recherche « Wilmotte » : 1 groupe sur ${pendant.tous}`, '[B] la ligne dit la recherche et son compte, celui de la grille', { texte: pendant.texte, tous: pendant.tous });
    ok(pendant.bouton === 'Tout afficher', '[B] « Tout afficher » est dans la ligne', pendant.bouton);
    const { bande, texte, bouton } = pendant.boites;
    ok(Boolean(bande && texte && bouton && bouton.w > 0 && bouton.h >= 24 && bouton.r <= bande.r + 0.5 && texte.l >= bande.l - 0.5), '[B] texte et bouton se voient en entier dans la ligne', pendant.boites);
    // Un filtre pose en plus : « Tout afficher » enleve les deux.
    await page.evaluate(() => setStaffStatusFilter('upcoming'));
    await FX.repos(page, 300);
    ok(await page.evaluate(() => state.staffStatusFilter) === 'upcoming', '[C] prerequis : un filtre est pose en plus de la recherche');
    await page.click('#planningBande [data-pb-tout]');
    await FX.repos(page, 300);
    const apres = await lire(page, BOWLING);
    ok(apres.terme === '' && apres.champ === '' && apres.filtre === 'all', '[C] « Tout afficher » enleve la recherche et le filtre', { terme: apres.terme, champ: apres.champ, filtre: apres.filtre });
    ok(apres.grisees === 0 && apres.nets === apres.tous && !apres.texte, '[C] toute la journee revient nette, la ligne disparait', apres);
    ok(!erreurs.length, '[F] aucune erreur JS (bowling)', erreurs);
  } finally { await ctx.close(); }
}

async function scenarioLaser(browser) {
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'normal', appareil: 'ordinateur', theme: 'light', port: PORT });
  try {
    await vue(page, 'laser');
    await chercher(page, 'Liam');
    const l = await lire(page, LASER);
    ok(l.tous >= 3 && l.nets === 1 && l.grisees > 0, '[D] prerequis : au laser, seul Liam reste net', l);
    ok(l.texte === `Recherche « Liam » : 1 groupe sur ${l.tous}`, '[D] au laser, la ligne compte avec la regle du laser', { texte: l.texte, tous: l.tous });
    ok(!erreurs.length, '[F] aucune erreur JS (laser)', erreurs);
  } finally { await ctx.close(); }
}

async function scenarioTablette(browser) {
  const { ctx, page, erreurs } = await FX.monter(browser, { fixture: 'normal', appareil: 'tablette', theme: 'light', port: PORT });
  try {
    await vue(page, 'bowling');
    await chercher(page, 'Wilmotte');
    const t = await lire(page, BOWLING);
    const { bande, texte, bouton } = t.boites;
    ok(Boolean(bande && texte && bouton) && texte.l >= bande.l - 0.5 && texte.r <= bande.r + 0.5 && bouton.r <= bande.r + 0.5 && bouton.b <= bande.b + 0.5 && bouton.h >= 24, '[E] a la tablette, texte et bouton tiennent dans la ligne', t.boites);
    ok(!erreurs.length, '[F] aucune erreur JS (tablette)', erreurs);
  } finally { await ctx.close(); }
}

const SCENARIOS = { demarrage: scenarioDemarrage, bowling: scenarioBowling, laser: scenarioLaser, tablette: scenarioTablette };
async function jouer(browser, noms) {
  for (const nom of noms) await SCENARIOS[nom](browser);
}

const MUTATIONS = [
  { nom: 'recherche-restauree', lettre: 'A', scenarios: ['demarrage'], editions: [
    { fichier: JS, de: "// et rien a l ecran ne disait pourquoi.\nstate.searchTerm = '';", vers: '// et rien a l ecran ne disait pourquoi.' },
  ] },
  { nom: 'ligne-absente', lettre: 'B', scenarios: ['bowling'], editions: [
    { fichier: GJS, de: "'<span class=\"pb-sep\" aria-hidden=\"true\"></span>' + pbRechercheHtml() + pbFiltreHtml([])", vers: "'<span class=\"pb-sep\" aria-hidden=\"true\"></span>' + pbFiltreHtml([])" },
  ] },
  { nom: 'ligne-pas-redessinee', lettre: 'B', scenarios: ['bowling'], editions: [
    { fichier: JS, de: '    // (la ligne sous la barre dit la recherche en cours : pbRechercheHtml)\n    renderKpis();\n', vers: '' },
  ] },
  { nom: 'filtre-garde', lettre: 'C', scenarios: ['bowling'], editions: [
    { fichier: JS, de: "  if (champ) champ.value = '';\n  state.staffStatusFilter = 'all';\n", vers: "  if (champ) champ.value = '';\n" },
  ] },
  { nom: 'laser-compte-tout', lettre: 'D', scenarios: ['laser'], editions: [
    { fichier: JS, de: '    nets = dessines.filter(lpChercheur(terme)).length;', vers: '    nets = dessines.length;' },
  ] },
  { nom: 'ligne-trop-large', lettre: 'E', scenarios: ['tablette'], editions: [
    { fichier: CSS, de: '.pb-recherche { flex: none;', vers: '.pb-recherche { flex: none; min-width: 1400px;' },
  ] },
];

async function main() {
  const serveurHttp = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, Object.keys(SCENARIOS));
    } else {
      console.log('[K] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[K] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        const avant = echecs;
        const garde = rouges.length;
        mutation = m;
        silence = !process.env.PR_BAVARD;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        mutation = null;
        const vus = rouges.slice(garde);
        rouges.length = garde;
        echecs = avant;
        ok(vus.some((l) => l.startsWith(`[${m.lettre}]`)), `[K] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveurHttp.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-recherche-check: FAIL ${echecs}`); process.exit(1); }
  console.log(`\nplanning-recherche-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
