// LES ECLATS D UN GATE (2026-10-19) : son travail joue par plusieurs
// processus fils au lieu d un seul, a l identique.
//
// Un gate dont chaque mutation (ou chaque contexte) rejoue des minutes de
// scenarios les jouait un par un (planning-laser : 16 mutations, 34 min). Ici
// le gate se relance lui-meme en N fils (`--eclat`) ; le pere leur donne les
// rangs a jouer UN PAR UN, au fil de l eau (un fils libre prend le suivant :
// les rangs couteux ne s entassent pas sur le meme fils) ; un fils joue SON
// rang avec exactement le code du gate et rend une ligne
// `ECLAT-RESULTAT <rang> <json>` ; le pere relit ces lignes et rend les
// verdicts dans l ordre, comme avant. Un fils qui plante ou ne rend pas un
// rang le fait rougir (jamais vert par defaut).
//
// Ports : un fils recoit `port + 1 + decalage + rang du fils` dans chaque
// variable de port nommee (le lanceur reserve 20 ports par variable).
// Nombre de fils : PINLANE_ECLATS (defaut 6) ou `nombre`, jamais plus que de rangs.
'use strict';
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const MARQUE = 'ECLAT-RESULTAT';
const DRAPEAU = '--eclat';
// Un fils cale s arrete avant le delai de l unite : le pere a le temps de dire
// lequel et ou il en etait, un gate tue par le lanceur ne laisse rien.
const DELAI_FILS_MS = Math.min(30 * 60, Math.max(60, Number(process.env.PINLANE_GATES_DELAI_S || 40 * 60) - 60)) * 1000;

function estFils(argv = process.argv) {
  return argv.includes(DRAPEAU);
}

function rendre(rang, valeur) {
  process.stdout.write(`${MARQUE} ${rang} ${JSON.stringify(valeur)}\n`);
}

// Le fils : lit ses rangs sur l entree standard, un par ligne, joue chacun
// et rend son resultat ; rend la main quand le pere ferme l entree. Un travail
// qui plante sort d ici sans que le pere l ait fermee : sous Windows, ce tube
// ouvert gardait le fils en vie, et le pere l attendait jusqu au delai, journal
// vide (fungalaxy-information, 15 min sur GitHub le 2026-10-30).
async function servir(travail) {
  const lecteur = readline.createInterface({ input: process.stdin });
  try {
    for await (const ligne of lecteur) {
      const rang = Number(String(ligne).trim());
      if (!String(ligne).trim() || !Number.isInteger(rang)) continue;
      rendre(rang, await travail(rang));
    }
  } finally {
    process.stdin.destroy();
  }
}

function nombreDeFils(total) {
  const voulu = Number(process.env.PINLANE_ECLATS || 6);
  return Math.max(1, Math.min(total, Number.isFinite(voulu) && voulu > 0 ? Math.floor(voulu) : 6));
}

function tuer(enfant) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(enfant.pid)], { stdio: 'ignore', windowsHide: true });
  else { try { enfant.kill('SIGKILL'); } catch (error) { /* fini */ } }
}

// Le pere : relance `fichier` avec `args` + --eclat dans N fils et leur
// distribue `rangs`. ports : { NOM_VARIABLE: portDeBase }. Rend
// Map(rang -> valeur) et, par fils, les rangs joues, son code et sa sortie
// (pour dire pourquoi un rang manque).
function eclater({ fichier, args = [], rangs, ports = {}, envFils = {}, delaiMs = DELAI_FILS_MS, nombre = 0, decalage = 0 }) {
  const n = nombre ? Math.max(1, Math.min(rangs.length, nombre)) : nombreDeFils(rangs.length);
  const file = [...rangs];
  const resultats = new Map();
  const sorties = [];
  return Promise.all(Array.from({ length: n }, (_, k) => new Promise((resolve) => {
    const env = { ...process.env, ...envFils };
    for (const [nom, base] of Object.entries(ports)) env[nom] = String(Number(base) + 1 + decalage + k);
    const enfant = spawn(process.execPath, [fichier, ...args, DRAPEAU], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const sortie = { part: [], code: null, texte: '' };
    sorties[k] = sortie;
    const donner = () => {
      if (!file.length) { enfant.stdin.end(); return; }
      const rang = file.shift();
      sortie.part.push(rang);
      enfant.stdin.write(`${rang}\n`);
    };
    let reste = '';
    enfant.stdout.on('data', (d) => {
      sortie.texte += d;
      reste += d;
      const lignes = reste.split(/\r?\n/);
      reste = lignes.pop();
      for (const ligne of lignes) {
        if (!ligne.startsWith(`${MARQUE} `)) continue;
        const espace = ligne.indexOf(' ', MARQUE.length + 1);
        const rang = Number(ligne.slice(MARQUE.length + 1, espace));
        try { resultats.set(rang, JSON.parse(ligne.slice(espace + 1))); } catch (error) { /* ligne coupee : le rang manquera */ }
        donner();
      }
    });
    enfant.stderr.on('data', (d) => { sortie.texte += d; });
    enfant.stdin.on('error', () => { /* fils mort : son rang manquera */ });
    // Un fils en retard s arrete avec ses navigateurs (l arbre entier).
    const minuteur = setTimeout(() => tuer(enfant), delaiMs);
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      sortie.code = code;
      resolve();
    });
    donner();
  }))).then(() => ({ resultats, sorties }));
}

// La fin de la sortie du fils qui avait ce rang, pour dire pourquoi il manque.
function pourquoiManque(sorties, rang) {
  const s = sorties.find((x) => x && x.part.includes(rang));
  if (!s) return 'aucun fils ne l a joue';
  return `fils code ${s.code} : ${s.texte.trim().split(/\r?\n/).filter((l) => !l.startsWith(MARQUE)).slice(-4).join(' | ').slice(0, 400)}`;
}

// La sortie du fils qui a joue ce rang, sans les lignes du protocole.
function texteDuFils(sorties, rang) {
  const s = sorties.find((x) => x && x.part.includes(rang));
  return s ? s.texte.split(/\r?\n/).filter((l) => l && !l.startsWith(`${MARQUE} `)).join('\n') : '';
}

// spawnSync, en asynchrone : le meme resultat ({ status, signal, stdout,
// stderr }) ; au delai, l arbre entier s arrete (status null, signal SIGTERM).
function lancer(fichier, args = [], { env = process.env, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [fichier, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let delai = false;
    enfant.stdout.on('data', (d) => { stdout += d; });
    enfant.stderr.on('data', (d) => { stderr += d; });
    const minuteur = timeout ? setTimeout(() => { delai = true; tuer(enfant); }, timeout) : null;
    enfant.on('close', (code, signal) => {
      if (minuteur) clearTimeout(minuteur);
      resolve({ status: delai ? null : code, signal: delai ? 'SIGTERM' : signal, stdout, stderr });
    });
  });
}

// Un pool : travail(item, fil) pour chaque item, `parallele` a la fois (fil =
// le rang de l ouvrier, pour son port) ; les resultats dans l ordre des items.
async function enPool(items, parallele, travail) {
  const resultats = new Array(items.length);
  let suivant = 0;
  const n = Math.max(1, Math.min(items.length, Number(parallele) || 1));
  await Promise.all(Array.from({ length: n }, async (_, fil) => {
    while (suivant < items.length) {
      const i = suivant;
      suivant += 1;
      resultats[i] = await travail(items[i], fil, i);
    }
  }));
  return resultats;
}

module.exports = { estFils, servir, rendre, eclater, pourquoiManque, texteDuFils, nombreDeFils, lancer, enPool };
