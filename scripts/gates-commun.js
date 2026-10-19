// CE QUE LE LANCEUR ET LA SELECTION PAR IMPACT PARTAGENT (2026-10-19).
//
// Un script npm `test:*` se decoupe en UNITES : chaque `node scripts/x.js
// [--drapeau]` de sa chaine `&&` est une unite, jouee seule, dans sa copie du
// depot (scripts/gates-lancer.js). La liste de la suite, les gates sensibles
// au temps et ceux qui se jouent toujours vivent dans scripts/gates-suite.json.
// Pur : lecture du disque et de git, aucune ecriture.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lf = (texte) => String(texte).split('\r\n').join('\n');
const SOURCES = new Map();
function lireSource(absolu) {
  if (!SOURCES.has(absolu)) { let texte = ''; try { texte = fs.readFileSync(absolu, 'utf8'); } catch (error) { texte = ''; } SOURCES.set(absolu, texte); }
  return SOURCES.get(absolu);
}

// Une source JS sans ses commentaires (les chaines sont gardees) : un nom de
// fichier cite dans un commentaire n est pas une dependance.
function sansCommentaires(source) {
  const morceaux = [];
  let i = 0;
  let garde = 0; // debut du morceau de code en cours
  let precedent = ''; // dernier caractere signifiant hors commentaire
  let mot = ''; // dernier identifiant (return, typeof precedent une regex)
  const n = source.length;
  const couper = (fin) => { if (fin > garde) morceaux.push(source.slice(garde, fin)); };
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { couper(i); while (i < n && source[i] !== '\n') i += 1; garde = i; continue; }
    if (c === '/' && source[i + 1] === '*') { couper(i); const f = source.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; morceaux.push(' '); garde = i; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      i += 1;
      while (i < n && source[i] !== c && (c === '`' || source[i] !== '\n')) { if (source[i] === '\\') i += 1; i += 1; }
      i += 1;
      precedent = c;
      mot = '';
      continue;
    }
    // Une expression reguliere (apres un operateur) : sautee telle quelle,
    // ses guillemets ne sont pas des chaines.
    if (c === '/' && (precedent === '' || '(,=:[!&|?{};+-*%<>~^'.includes(precedent) || mot === 'return' || mot === 'typeof')) {
      i += 1;
      let classe = false;
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') classe = true;
        else if (source[i] === ']') classe = false;
        else if (source[i] === '/' && !classe) break;
        i += 1;
      }
      i += 1;
      precedent = '/';
      mot = '';
      continue;
    }
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') {
      if (/[\w$]/.test(c)) mot = (i > 0 && /[\w$]/.test(source[i - 1]) ? mot : '') + c;
      else mot = '';
      precedent = c;
    }
    i += 1;
  }
  couper(n);
  return morceaux.join('');
}

function scriptsNpm(racine = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).scripts || {};
}

function configSuite(racine = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(racine, 'scripts/gates-suite.json'), 'utf8'));
}

// `node scripts/x.js --a --b` -> { fichier: 'scripts/x.js', args: ['--a', '--b'] }.
// Une commande qui n a pas cette forme est refusee : le lanceur ne joue que
// des gates node, sans shell, pour pouvoir les isoler.
const FORME = /^node ((?:scripts|tools)\/[\w.-]+\.c?js)((?: --?[\w=:,./-]+)*)$/;
// Un nom est un script npm, ou une commande `node scripts/x.js [--drapeau]`
// donnee telle quelle (une unite hors npm, par exemple un --mutate a essayer).
function unites(nom, scripts = scriptsNpm()) {
  const ligne = /^node /.test(nom) ? nom : scripts[nom];
  if (!ligne) throw new Error(`script npm inconnu : ${nom}`);
  return ligne.split('&&').map((brut, rang) => {
    const commande = brut.trim();
    const m = FORME.exec(commande);
    if (!m) throw new Error(`${nom} : commande que le lanceur ne sait pas isoler : ${commande}`);
    return { script: nom, rang, fichier: m[1], args: m[2].trim() ? m[2].trim().split(/\s+/) : [], commande };
  });
}

// Les fichiers du depot tels que git les voit : suivis et non suivis, sans
// les ignores (node_modules, tmp, artifacts, .env).
function fichiersDuDepot(racine = ROOT) {
  const sortie = execFileSync('git', ['-C', racine, 'ls-files', '-z', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const vus = new Set();
  return sortie.split('\0').filter(Boolean).filter((rel) => {
    if (vus.has(rel)) return false;
    vus.add(rel);
    try { return fs.statSync(path.join(racine, rel)).isFile(); } catch (error) { return false; }
  });
}

// Les scripts de scripts/ qu un gate charge ou lance : require relatifs,
// noms de fichier litteraux (spawn de ses propres fils, serveurs de dev).
const LIENS = new Map();
function liensDirects(fichier, racine) {
  const cle = `${racine}|${fichier}`;
  if (LIENS.has(cle)) return LIENS.get(cle);
  const liens = new Set();
  LIENS.set(cle, liens);
  // Commentaires compris : un lien de trop ne coute qu une variable de port
  // ou un gate selectionne en plus ; un lien manque laisserait un fils sur
  // son port par defaut, partage entre deux places du pool.
  const source = lireSource(path.join(racine, fichier));
  const dossier = path.posix.dirname(fichier);
  for (const m of source.matchAll(/['"`]((?:\.{1,2}\/)?[\w./-]+?)(\.c?js)?['"`]/g)) {
    const brut = m[1] + (m[2] || '');
    let essai = '';
    if (brut.startsWith('.')) essai = path.posix.normalize(path.posix.join(dossier, brut));
    else if (/^scripts\//.test(brut)) essai = brut;
    else if (!brut.includes('/')) essai = `scripts/${brut}`;
    if (!essai.startsWith('scripts/')) continue;
    for (const c of [essai, `${essai}.js`, `${essai}.cjs`]) {
      if (/^scripts\/[\w.-]+\.c?js$/.test(c) && c !== fichier && existeFichier(path.join(racine, c))) { liens.add(c); break; }
    }
  }
  return liens;
}
// Un fichier de scripts/ existe s il est dans la liste du dossier (lue une
// fois : un stat par litteral coutait des secondes sous Windows).
const DOSSIERS = new Map();
function existeFichier(absolu) {
  const dossier = path.dirname(absolu);
  if (!DOSSIERS.has(dossier)) {
    let noms = new Set();
    try { noms = new Set(fs.readdirSync(dossier, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)); } catch (error) { noms = new Set(); }
    DOSSIERS.set(dossier, noms);
  }
  return DOSSIERS.get(dossier).has(path.basename(absolu));
}
function scriptsLies(fichier, racine = ROOT) {
  const vus = new Set([fichier]);
  const pile = [fichier];
  while (pile.length) {
    for (const lien of liensDirects(pile.pop(), racine)) if (!vus.has(lien)) { vus.add(lien); pile.push(lien); }
  }
  return vus;
}

// Les variables de port qu une unite lit (elle et les scripts qu elle lance).
function variablesDePort(fichier, racine = ROOT) {
  const noms = new Set();
  for (const f of scriptsLies(fichier, racine)) {
    const source = lireSource(path.join(racine, f));
    for (const m of source.matchAll(/process\.env\.(PINLANE_[A-Z0-9_]*PORT[A-Z0-9_]*)/g)) noms.add(m[1]);
  }
  return [...noms].sort();
}

// Un gate pilote un navigateur s il (ou un script qu il lance) charge Playwright.
function piloteUnNavigateur(fichier, racine = ROOT) {
  for (const f of scriptsLies(fichier, racine)) {
    if (/require\(['"]playwright(?:-core)?['"]\)|from ['"]playwright/.test(lireSource(path.join(racine, f)))) return true;
  }
  return false;
}

module.exports = { ROOT, lf, sansCommentaires, scriptsNpm, configSuite, unites, fichiersDuDepot, scriptsLies, variablesDePort, piloteUnNavigateur };
