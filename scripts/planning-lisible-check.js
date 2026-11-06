// LE GRAND TABLEAU SE LIT D UN COUP D OEIL (2026-11-06, l ecran d Ansar).
//
// Ansar, 06/11, sur trois captures du planning complet : « bug graphique la, une case
// fluo et l autre juste le fond », « on doit voir plus visiblement la note c un client
// avec couleur et mieux explique que c une note client, pareil pour note equipe »,
// « quand c modifie pas besoin d ecrire sur la page ici que ca a ete modifie, ca prend
// trop de place », « la barre qui montre l heure actuelle [...] elle perturbe, place-la
// bien par temps ». Ce gate garde les quatre reponses, sur la vraie console, la journee
// normale avec de vraies notes (scripts/planning-v3-fixtures.js, variantes sansdemo et
// notes), au PC du comptoir :
//   [A] LES NOTES : « Note du client » et « Note de l equipe » en etiquette pleine, deux
//       teintes differentes, lisibles (4,5:1) en clair et en sombre, le texte a leur suite ;
//   [B] « MODIFIE » NE S ECRIT PLUS sur la ligne, alors que deux dossiers sont modifies ;
//   [C] DEUX PARTIES DANS LA MEME CASE : deux pastilles de la meme forme, la partie qui
//       se joue pleine, celle qui vient claire, plus de bande sur la moitie de la case ;
//   [D] LA BARRE DE L HEURE NE PREND AUCUNE PLACE : rien entre les deux lignes qu elle
//       separe, son trait et sa pastille se voient ;
//   [E] DANS UNE DEMI-HEURE LIBRE, LA BARRE TOMBE A SA MINUTE (20:38 au quart de 20:30),
//       descend quand la minute passe, et la ligne qui suit garde son filet.
// --contre-preuves : chaque regle retiree (au texte servi, le disque n est jamais touche)
// fait rougir sa lettre ; chaque ancre existe une fois et une seule.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const FX = require('./planning-v3-fixtures');

const ROOT = path.resolve(__dirname, '..');
// 5217 : aucun autre gate ne le prend.
const PORT = Number(process.env.PINLANE_PLANNING_LISIBLE_PORT || 5217);
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PG = 'assets/pinlane-planning-global.js';
const PGC = 'assets/pinlane-planning-global.css';
FX.APPAREILS.comptoir = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: 'fr-BE' };
const JOUR = FX.lireFixture('normal').staffState.date;

let echecs = 0;
let silence = false;
let mutation = null;
const rouges = [];
class Mordu extends Error {}
function ok(cond, label, detail = '') {
  if (!cond) { echecs += 1; rouges.push(label); }
  if (!silence) console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail !== '' ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`);
  if (!cond && mutation && mordu(label)) throw new Mordu(label);
  return cond;
}
const mordu = (label) => label.startsWith(`[${mutation.lettre}]`) && !mutation.deDepart.has(label);
function transformer(rel, texte) {
  if (!mutation) return texte;
  let t = texte.replace(/\r\n/g, '\n');
  for (const ed of mutation.editions) if (ed.fichier === rel) t = t.replace(ed.de, () => ed.vers);
  return t;
}

async function avec(browser, { lettre, heure, theme = 'light' }, corps) {
  const m = await FX.monter(browser, { fixture: 'normal', appareil: 'comptoir', theme, heure, port: PORT, variante: ['sansdemo', 'notes'] });
  try {
    await corps(m.page);
    ok(m.erreurs.length === 0, `[${lettre}] aucune erreur de page (${heure}, ${theme})`, m.erreurs.slice(0, 3));
  } finally { await m.ctx.close(); }
}
const ligneDe = (nom) => `Array.from(document.querySelectorAll('.gf-r')).find((tr) => tr.querySelector('.gf-nom__t').textContent.includes(${JSON.stringify(nom)}))`;

// Une couleur calculee, en trois valeurs de 0 a 255. Le navigateur rend un melange
// (color-mix) en « color(srgb 0.96 0.92 0.85) », de 0 a 1, et le reste en « rgb(...) ».
function rgb(c) {
  const v = (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  return /^color\(srgb/.test(String(c)) ? v.map((x) => x * 255) : v;
}
// Le contraste de deux couleurs calculees (sur un fond opaque).
function contraste(a, b) {
  const lum = (c) => {
    const [r, g, bl] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const transparent = (c) => !c || c === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);
// L ecart de deux couleurs, en distance RGB : une pastille se detache de son fond a 25 au moins
// (blanche sur la case doree : 38 ; la teinte claire de la pastille sur ce meme fond : 9).
const ecart = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

// ---------------------------------------------------------------------------
// [A] LES NOTES SE VOIENT ET DISENT QUI LES A ECRITES
// ---------------------------------------------------------------------------
async function notes(browser) {
  for (const theme of ['light', 'dark']) {
    await avec(browser, { lettre: 'A', heure: '19:40', theme }, async (page) => {
      const n = await page.evaluate(`(() => {
        const tr = ${ligneDe('Équipe de basket')};
        const lire = (cle) => {
          const d = tr && tr.querySelector('.gf-i--' + cle);
          if (!d) return null;
          const s = d.querySelector('.gf-i__mot'), p = d.querySelector('p');
          if (!s || !p) return { mot: (d.querySelector('span') || {}).textContent || '', texte: p ? p.textContent : '', fond: '', encre: '' };
          const cs = getComputedStyle(s);
          // (le premier mot apres l etiquette : sur la meme ligne qu elle, a sa droite)
          const apres = document.createRange();
          const n = s.nextSibling && s.nextSibling.nodeType === 3 && s.nextSibling.textContent.trim() ? s.nextSibling : (s.nextElementSibling || s.nextSibling);
          apres.selectNodeContents(n);
          const ra = apres.getClientRects()[0] || { top: -99, left: -99 };
          return { mot: s.textContent, texte: p.textContent.slice(p.textContent.indexOf(s.textContent) + s.textContent.length).trim(), fond: cs.backgroundColor, encre: cs.color, haut: Math.round(s.getBoundingClientRect().top), hautTexte: Math.round(ra.top), droite: Math.round(s.getBoundingClientRect().right), gauche: Math.round(ra.left), lignesP: Math.round(p.clientHeight / parseFloat(getComputedStyle(p).lineHeight)) };
        };
        return { client: lire('client'), equipe: lire('equipe'), fondLigne: getComputedStyle(tr.querySelector('td.gf-nom')).backgroundColor, page: getComputedStyle(document.body).backgroundColor };
      })()`);
      const { client: c, equipe: e } = n;
      ok(Boolean(c && e), `[A] le montage (${theme}) : l Equipe de basket a un mot du client et une note de l equipe`, n);
      if (!c || !e) return;
      ok(c.mot === 'Note du client' && /plus tard/.test(c.texte) && !/Note du client/.test(c.texte), `[A] « Note du client » en toutes lettres, le texte a part (${theme})`, c);
      ok(e.mot === 'Note de l’équipe' && /Acompte/.test(e.texte) && /Sarah/.test(e.texte), `[A] « Note de l’équipe » en toutes lettres, avec son auteur (${theme})`, e);
      const fond = transparent(n.fondLigne) ? n.page : n.fondLigne;
      ok(!transparent(c.fond) && !transparent(e.fond) && c.fond !== e.fond && c.fond !== fond && e.fond !== fond, `[A] deux etiquettes pleines, deux teintes, aucune couleur du fond (${theme})`, { client: c.fond, equipe: e.fond, fond });
      ok(contraste(c.encre, c.fond) >= 4.5 && contraste(e.encre, e.fond) >= 4.5, `[A] les etiquettes se lisent, 4,5:1 au moins (${theme})`, { client: contraste(c.encre, c.fond).toFixed(2), equipe: contraste(e.encre, e.fond).toFixed(2) });
      ok(Math.abs(c.haut - c.hautTexte) <= 4 && c.gauche >= c.droite && Math.abs(e.haut - e.hautTexte) <= 4, `[A] le texte suit son etiquette, sur la meme ligne (${theme})`, { c, e });
    });
  }
}

// ---------------------------------------------------------------------------
// [B] « MODIFIE » NE S ECRIT PLUS SUR LA LIGNE
// ---------------------------------------------------------------------------
async function modifie(browser) {
  await avec(browser, { lettre: 'B', heure: '19:40' }, async (page) => {
    const b = await page.evaluate(`(() => ({
      modifies: state.reservations.filter((r) => texteDerniereModif(r)).length,
      rubriques: document.querySelectorAll('.gf-t .gf-i--modif').length,
      mot: Array.from(document.querySelectorAll('.gf-t .gf-i > span')).filter((s) => /^Modifié/.test(s.textContent)).length,
    }))()`);
    ok(b.modifies >= 2, '[B] le montage : deux dossiers de la journee sont modifies', b);
    ok(b.rubriques === 0 && b.mot === 0, '[B] aucune ligne n ecrit « Modifié » : la fiche le garde', b);
  });
}

// ---------------------------------------------------------------------------
// [C] DEUX PARTIES DANS LA MEME CASE : LA CASE ENTIERE PREND LE FOND
// ---------------------------------------------------------------------------
async function deuxParties(browser) {
  await avec(browser, { lettre: 'C', heure: '19:40' }, async (page) => {
    const c = await page.evaluate(`(() => {
      const tr = ${ligneDe('Équipe de basket')};
      const cas = tr && tr.querySelector('td.gf-a.is-plusieurs');
      if (!cas) return null;
      // (la souris hors du tableau : le survol ne repeint pas la case)
      return {
        fondCase: getComputedStyle(cas).backgroundColor,
        parties: Array.from(cas.querySelectorAll('.gf-x')).map((x) => {
          const t = x.querySelector('.gf-x__t');
          const ct = getComputedStyle(t), cx = getComputedStyle(x);
          return { classe: x.className, heure: t.textContent, fond: cx.backgroundColor, pastille: ct.backgroundColor, encre: cx.color, gras: Number(cx.fontWeight) };
        }),
      };
    })()`);
    const p = c && c.parties;
    ok(Array.isArray(p) && p.length === 2 && /is-encours/.test(p[0].classe) && /is-(avenir|bientot)/.test(p[1].classe), '[C] le montage : la partie de 19:30 se joue, celle de 20:00 vient, dans la meme case', c);
    if (!Array.isArray(p) || p.length !== 2) return;
    const [jouee, vient] = p;
    ok(!transparent(c.fondCase) && c.fondCase === jouee.fond, '[C] la case entiere prend le fond de la partie qui se joue : plus de bande sur la moitie', c);
    ok(jouee.gras >= 600 && contraste(jouee.encre, c.fondCase) >= 4.5, '[C] la partie qui se joue : en gras, lisible sur ce fond', c);
    ok(!transparent(vient.pastille) && ecart(vient.pastille, c.fondCase) >= 25, '[C] la partie qui vient garde sa pastille, nette sur ce fond', { ...c, ecart: Math.round(ecart(vient.pastille, c.fondCase)) });
  });
}

// ---------------------------------------------------------------------------
// [D] LA BARRE NE PREND AUCUNE PLACE
// ---------------------------------------------------------------------------
async function barre(browser) {
  await avec(browser, { lettre: 'D', heure: '19:40' }, async (page) => {
    const d = await page.evaluate(`(() => {
      const now = document.querySelector('.gf-t tr.gf-now');
      if (!now) return null;
      const avant = now.previousElementSibling, apres = now.nextElementSibling;
      const trait = getComputedStyle(now.querySelector('td'), '::after');
      const h = now.querySelector('.gf-now__h');
      return {
        hauteur: Math.round(now.getBoundingClientRect().height),
        ecart: Math.round(apres.getBoundingClientRect().top - avant.getBoundingClientRect().bottom),
        avant: avant.textContent.slice(0, 40), apres: apres.textContent.slice(0, 40),
        trait: trait.display !== 'none' && parseFloat(trait.height) >= 2, ancre: now.classList.contains('is-ancre'),
        pastille: h ? h.textContent : '', pastilleVue: h ? getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0 : false,
      };
    })()`);
    ok(Boolean(d) && /basket/.test(d.avant) && /Julie/.test(d.apres) && !d.ancre, '[D] le montage : a 19:40, la barre passe entre le basket (19:30) et Julie (20:00)', d);
    if (!d) return;
    ok(d.hauteur <= 1 && Math.abs(d.ecart) <= 1, '[D] la barre ne prend aucune place : rien entre les deux lignes', d);
    ok(d.trait && d.pastilleVue && d.pastille === '19:40', '[D] son trait et sa pastille se voient', d);
  });
}

// ---------------------------------------------------------------------------
// [E] DANS UNE DEMI-HEURE LIBRE, LA BARRE TOMBE A SA MINUTE
// ---------------------------------------------------------------------------
async function minute(browser) {
  await avec(browser, { lettre: 'E', heure: '20:38' }, async (page) => {
    const lire = () => page.evaluate(`(() => {
      const libre = Array.from(document.querySelectorAll('.gf-t tr.gf-libre')).find((tr) => /20:30/.test(tr.textContent));
      const l = libre && libre.querySelector('.gf-now__l');
      const ancre = document.querySelector('.gf-t tr.gf-now');
      const suivante = ancre && ancre.nextElementSibling;
      const h = l && l.querySelector('.gf-now__h');
      if (!libre || !l) return { libre: Boolean(libre), trait: false, ancre: ancre ? ancre.className : '' };
      const rl = libre.getBoundingClientRect(), rt = l.getBoundingClientRect();
      return {
        libre: true, trait: true,
        part: (rt.top + rt.height / 2 - rl.top) / rl.height, hLibre: Math.round(rl.height),
        pastille: h ? h.textContent : '', pastilleDedans: h ? h.getBoundingClientRect().top >= rl.top - 1 && h.getBoundingClientRect().bottom <= rl.bottom + 1 : false,
        ancre: ancre ? ancre.className : '', ancreMuette: ancre ? getComputedStyle(ancre.querySelector('td'), '::after').display === 'none' && getComputedStyle(ancre.querySelector('.gf-now__h')).display === 'none' : false,
        filet: suivante ? parseFloat(getComputedStyle(suivante.querySelector('td')).borderTopWidth) : -1, suivante: suivante ? suivante.textContent.slice(0, 20) : '',
      };
    })()`);
    const a = await lire();
    ok(a.libre && a.trait, '[E] a 20:38, la demi-heure de 20:30 est libre et porte le trait', a);
    if (!a.trait) return;
    ok(Math.abs(a.part - 8 / 30) <= 0.06 && a.pastille === '20:38' && a.pastilleDedans, '[E] le trait tombe a sa minute : 20:38 au quart de la case de 20:30, sa pastille dans la case', a);
    ok(/is-ancre/.test(a.ancre) && a.ancreMuette, '[E] la rangee de l heure n est plus qu une ancre, sans trait ni pastille', a);
    ok(a.filet >= 1 && /21:00/.test(a.suivante), '[E] la demi-heure qui suit garde son filet', a);
    await page.clock.setFixedTime(FX.instant(JOUR, '20:52'));
    await page.evaluate(() => tickHorlogeStaff());
    await FX.repos(page, 200);
    const b = await lire();
    ok(b.trait && Math.abs(b.part - 22 / 30) <= 0.06 && b.part > a.part && b.pastille === '20:52', '[E] la minute passe : le trait descend, la pastille dit 20:52', { avant: a, apres: b });
  });
}

const SCENARIOS = { notes, modifie, deuxParties, barre, minute };
const LETTRES = { notes: 'A', modifie: 'B', deuxParties: 'C', barre: 'D', minute: 'E' };
async function jouer(browser, noms) { for (const n of noms) await SCENARIOS[n](browser); }

// ---------------------------------------------------------------------------
// LES CONTRE-PREUVES
// ---------------------------------------------------------------------------
const MUTATIONS = [
  { nom: 'etiquette-sans-fond', lettre: 'A', scenarios: ['notes'], editions: [{ fichier: PGC, de: '.gf-i--client .gf-i__mot { background: var(--gf-note-client); color: var(--gf-note-client-encre); }', vers: '' }] },
  { nom: 'libelle-client-court', lettre: 'A', scenarios: ['notes'], editions: [{ fichier: PG, de: "gfRubrique('client', 'Note du client',", vers: "gfRubrique('client', 'Client'," }] },
  { nom: 'modifie-revient', lettre: 'B', scenarios: ['modifie'], editions: [{ fichier: PG, de: "    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));\n", vers: "    if (prix) liste.push(gfRubrique('prix', 'Prix', gpEsc(prix), prix));\n    var modif = typeof texteDerniereModif === 'function' ? texteDerniereModif(r, { max: 4 }) : '';\n    if (modif) liste.push(gfRubrique('modif', 'Modifié', gpEsc(modif.replace(/^Modifié\\s*/, '')), modif));\n" }] },
  { nom: 'demi-bande', lettre: 'C', scenarios: ['deuxParties'], editions: [{ fichier: PGC, de: '  .gf-t .gf-r > td.gf-a.is-plusieurs.is-encours { background: var(--bk-haut); }', vers: '' }] },
  { nom: 'case-sans-etat', lettre: 'C', scenarios: ['deuxParties'], editions: [{ fichier: PG, de: "    var fond = etats.indexOf('retard') >= 0 ? ' is-retard' : etats.indexOf('encours') >= 0 ? ' is-encours' : '';", vers: "    var fond = '';" }] },
  { nom: 'pastille-fondue', lettre: 'C', scenarios: ['deuxParties'], editions: [{ fichier: PGC, de: ' .gf-x__t:not(.is-nu) { background: var(--surface); }', vers: ' .gf-x__t:not(.is-nu) { }' }] },
  { nom: 'barre-epaisse', lettre: 'D', scenarios: ['barre'], editions: [{ fichier: PGC, de: '.gf-t tr.gf-now > td { position: relative; height: 0;', vers: '.gf-t tr.gf-now > td { position: relative; height: 16px;' }] },
  { nom: 'barre-au-bord', lettre: 'E', scenarios: ['minute'], editions: [{ fichier: PG, de: '        dansLibre = !q && m.maintenant != null', vers: '        dansLibre = false && m.maintenant != null' }] },
  { nom: 'barre-figee', lettre: 'E', scenarios: ['minute'], editions: [{ fichier: PG, de: '      if (trait.style.top !== haut) trait.style.top = haut;\n', vers: '' }] },
  { nom: 'filet-perdu', lettre: 'E', scenarios: ['minute'], editions: [{ fichier: PG, de: "      var nu = !avant || (avant.cle === 'maintenant' && avant.html.indexOf(' is-ancre') < 0);", vers: "      var nu = !avant || avant.cle === 'maintenant';" }] },
];

async function rougesDeDepart(browser, scenarios) {
  const garde = rouges.length;
  const avant = echecs;
  silence = true;
  try { await jouer(browser, scenarios); } catch (e) { rouges.push(`crash ${e.message}`); }
  silence = false;
  const vus = new Set(rouges.slice(garde));
  rouges.length = garde;
  echecs = avant;
  return vus;
}

async function main() {
  const serveur = await FX.servir({ port: PORT, transformer });
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const t0 = Date.now();
  try {
    if (!process.argv.includes('--contre-preuves')) {
      await jouer(browser, Object.keys(SCENARIOS));
    } else {
      console.log('[CP] contre-preuves : chaque regle retiree fait rougir sa lettre');
      for (const m of MUTATIONS) {
        const ancres = m.editions.map((ed) => fs.readFileSync(path.join(ROOT, ed.fichier), 'utf8').replace(/\r\n/g, '\n').split(ed.de).length - 1);
        if (!ok(ancres.every((n) => n === 1), `[CP] mutation ${m.nom} : chaque ancre existe une fois et une seule`, ancres)) continue;
        if (!ok(m.scenarios.every((s) => LETTRES[s] === m.lettre), `[CP] mutation ${m.nom} : ses scenarios portent sa lettre`, m.scenarios)) continue;
        const deDepart = await rougesDeDepart(browser, m.scenarios);
        const avant = echecs;
        const garde = rouges.length;
        mutation = { ...m, deDepart };
        silence = true;
        try {
          await jouer(browser, m.scenarios);
        } catch (e) { if (!(e instanceof Mordu)) rouges.push(`[${m.lettre}] crash ${e.message}`); }
        silence = false;
        const vus = rouges.slice(garde);
        const mord = vus.some(mordu);
        mutation = null;
        rouges.length = garde;
        echecs = avant;
        ok(mord, `[CP] mutation ${m.nom} : [${m.lettre}] rougit`, vus.slice(0, 3).join(' ; ') || 'rien n a rougi');
      }
    }
  } finally {
    await browser.close();
    serveur.close();
  }
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  if (echecs) { console.error(`\nplanning-lisible-check: FAIL ${echecs}`); process.exitCode = 1; return; }
  console.log(`\nplanning-lisible-check: ALL OK${process.argv.includes('--contre-preuves') ? ' (contre-preuves)' : ''}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
