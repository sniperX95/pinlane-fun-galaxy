// UN GATE A LA DATE FIGEE GARDE LES MINUTEURS DE SA PAGE, QUEL QUE SOIT LE JOUR
// (scripts/gates-horloge.js, 2026-10-30).
//
//   [A] tout gate qui remplace global.Date et se sert de page.clock passe par
//       figerPage, ou rend la vraie classe avant (liste-statuts) : un appel
//       direct marche jusqu au jour ou l ecart depasse 24,855 jours, puis rougit
//       sans que rien n ait change ;
//   [B] Node decale de 40 jours, figerPage : la page lit l instant demande,
//       requestAnimationFrame et setTimeout y partent ;
//   [C] CONTRE-EPREUVE : le meme decalage avec page.clock.setFixedTime en
//       direct : les minuteurs ne partent plus, [B] prouve donc quelque chose.
//
// Lancement : node scripts/gates-horloge-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { figerPage } = require('./gates-horloge');

const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DOSSIER = __dirname;
const JOUR_MS = 86400000;
let echecs = 0;
function ok(condition, message, detail) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${message}${detail ? `  ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

const Vraie = Date;
function decalerNode(jours) {
  const depart = Vraie.now();
  const cible = depart - jours * JOUR_MS;
  global.Date = class DateDuGate extends Vraie {
    constructor(...a) { if (a.length === 0) super(cible + (Vraie.now() - depart)); else super(...a); }
    static now() { return cible + (Vraie.now() - depart); }
  };
}

// Les minuteurs de la page repondent-ils ? 4 s suffisent : ils repondent en
// quelques millisecondes ou jamais.
async function minuteurs(page) {
  const essai = (texte) => Promise.race([
    page.evaluate(texte).then(() => true),
    new Promise((resolve) => { setTimeout(() => resolve(false), 4000); }),
  ]);
  return {
    image: await essai('new Promise((r) => requestAnimationFrame(r))'),
    delai: await essai('new Promise((r) => setTimeout(r, 10))'),
  };
}

async function scenario(browser, figer) {
  decalerNode(40);
  const instant = new Vraie(Vraie.now() - 40 * JOUR_MS);
  const page = await browser.newPage();
  try {
    await figer(page, instant);
    await page.goto('about:blank');
    const vus = await minuteurs(page);
    const lue = await page.evaluate('new Date().toISOString()');
    return { ...vus, lue, voulue: instant.toISOString() };
  } finally {
    global.Date = Vraie;
    await page.close().catch(() => {});
  }
}

function statique() {
  console.log('[A] les gates a la date figee passent par figerPage');
  const fautifs = [];
  let vus = 0;
  for (const nom of fs.readdirSync(DOSSIER).filter((f) => f.endsWith('-check.js') && f !== path.basename(__filename))) {
    const source = fs.readFileSync(path.join(DOSSIER, nom), 'utf8');
    if (!/global\.Date\s*=/.test(source)) continue;
    const direct = /\.clock\.\w+\(/.test(source);
    if (direct || /figerPage\(/.test(source)) vus += 1;
    // liste-statuts rend la vraie classe a Node avant ses scenarios d horloge.
    const rendue = /global\.Date\s*=\s*(NativeDate|RealDate)\b/.test(source);
    if (direct && !rendue) fautifs.push(nom);
  }
  ok(vus > 0, 'MONTAGE [A] des gates melent une date figee et page.clock', `${vus} gate(s)`);
  ok(fautifs.length === 0, '[A] aucun appel direct a page.clock sous une date figee', fautifs.join(', '));
}

(async () => {
  statique();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  try {
    console.log('[B] Node decale de 40 jours, figerPage');
    const b = await scenario(browser, figerPage);
    ok(b.image && b.delai, '[B] requestAnimationFrame et setTimeout partent dans la page', JSON.stringify(b));
    ok(b.lue.slice(0, 16) === b.voulue.slice(0, 16), '[B] la page lit l instant demande', b.lue);
    console.log('[C] contre-epreuve : page.clock en direct, sous la meme date');
    const c = await scenario(browser, (page, instant) => page.clock.setFixedTime(new Date(instant.getTime())));
    ok(!c.image && !c.delai, '[C] sans figerPage, les minuteurs de la page ne partent plus : [B] prouve quelque chose', JSON.stringify(c));
  } finally {
    await browser.close();
  }
  if (echecs) {
    console.error(`\ngates-horloge-check: ${echecs} FAIL`);
    process.exit(1);
  }
  console.log('\ngates-horloge-check: ALL OK');
})().catch((error) => { console.error(error); process.exit(1); });
