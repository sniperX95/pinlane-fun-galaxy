// LE MOUVEMENT DE LA CONSOLE RESTE LÉGER (2026-11-19).
//
// Ansar : « tout ce qui fait joli [...] est mal fait, souvent très lourd et ça
// fait lagger ». Mesuré avant ce lot (scripts/mouvement-banc.js, processeur
// bridé x4) : des animations sans fin repeignaient l'écran au repos sur toutes
// les pages, des transitions recalculaient la mise en page à chaque image.
//
// Ce gate garde la règle du mouvement de la console (DESIGN.md §5) dans les
// feuilles chargées par index.html, hors l'ancien tunnel client
// (pinlane-client.css, qui ne s'affiche jamais en console et a sa propre
// grammaire, gardée par visit-motion-check) :
//   [A] une transition n'anime que transform, opacity, les couleurs ou une
//       propriété de position indépendante (translate, scale, rotate) ;
//   [B] une @keyframes n'anime que transform, opacity, les couleurs, ou
//       stroke-dashoffset / clip-path quand la ligne le permet ;
//   [C] jamais `transition: all` ;
//   [D] aucun flou d'arrière-plan (backdrop-filter) ;
//   [E] une animation sans fin est un signe de travail (chargement) qui
//       n'anime que transform ou opacity ;
//   [F] aucune transition d'interface ne dure plus de 450 ms.
// Une exception se pose À LA LIGNE, jamais au fichier, avec sa raison :
//   /* mouvement-permis : <raison> */
//
// Contre-preuves : node scripts/mouvement-check.js --contre-preuves
// (la feuille est cassée en mémoire, le disque n'est jamais touché).
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const HORS = new Set(['assets/pinlane-client.css']);
const PERMIS = /mouvement-permis\s*:\s*\S/;
// (une couleur repeint l'élément seul, sans rien déplacer : légère sur une durée courte ;
// `background` sur un survol n'y change que la couleur)
const LEGERES = /^(transform|translate|scale|rotate|opacity|color|background|background-color|border-color|border-[a-z]+-color|outline-color|fill|stroke|fill-opacity|stroke-opacity|text-decoration-color|caret-color|visibility|--[\w-]+|none)$/;
const ANIMABLES = /^(transform|translate|scale|rotate|opacity|color|background-color|border-color|border-[a-z]+-color|outline-color|fill|stroke|visibility|offset|offset-distance|--[\w-]+|content|z-index|pointer-events|transform-origin|animation-timing-function)$/;
const ANIMABLES_SI_PERMIS = /^(stroke-dashoffset|stroke-dasharray|clip-path)$/;

function feuilles() {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  return [...html.matchAll(/<link[^>]+href="\/?(assets\/[^"?]+\.css)/g)].map((m) => m[1]).filter((f) => !HORS.has(f));
}

function ms(texte) {
  return [...String(texte).matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])));
}

// Découpe une valeur de transition en propriétés (les virgules d'une fonction ne coupent pas).
function proprietesDeTransition(valeur) {
  const parts = [];
  let profondeur = 0, cour = '';
  for (const c of valeur) {
    if (c === '(') profondeur++;
    if (c === ')') profondeur--;
    if (c === ',' && profondeur === 0) { parts.push(cour); cour = ''; } else cour += c;
  }
  parts.push(cour);
  return parts.map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
}

// Analyse une feuille : renvoie les fautes, et la liste des keyframes avec leurs propriétés.
function analyser(fichier, texte) {
  const fautes = [];
  const keyframes = new Map();
  const lignes = texte.split(/\r?\n/);
  // 1. Les @keyframes, avec la ligne de leur en-tête (pour le permis).
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(texte))) {
    let i = re.lastIndex, d = 1;
    while (i < texte.length && d > 0) { if (texte[i] === '{') d++; else if (texte[i] === '}') d--; i++; }
    const corps = texte.slice(re.lastIndex, i - 1);
    const ligne = texte.slice(0, m.index).split(/\r?\n/).length;
    const props = [...new Set([...corps.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]))];
    keyframes.set(m[1], { props, ligne, permis: PERMIS.test(lignes[ligne - 1]) });
    for (const p of props) {
      if (ANIMABLES.test(p)) continue;
      if (ANIMABLES_SI_PERMIS.test(p) && PERMIS.test(lignes[ligne - 1])) continue;
      if (PERMIS.test(lignes[ligne - 1])) continue;
      fautes.push({ regle: 'B', ou: `${fichier}:${ligne}`, quoi: `@keyframes ${m[1]} anime ${p}` });
    }
  }
  // 2. Les déclarations, ligne par ligne (les keyframes sont sautées).
  let dansKf = 0;
  lignes.forEach((l, i) => {
    const ou = `${fichier}:${i + 1}`;
    if (/@keyframes\s/.test(l)) dansKf = 1;
    if (dansKf) {
      // compte les accolades pour sortir de la keyframe
      dansKf += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length - (/@keyframes\s/.test(l) ? 1 : 0);
      if (dansKf <= 0) dansKf = 0;
      return;
    }
    const permis = PERMIS.test(l);
    for (const t of l.matchAll(/(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g)) {
      const valeur = t[1];
      if (/^\s*none\b/.test(valeur)) continue;
      const props = proprietesDeTransition(valeur);
      if (props.includes('all')) fautes.push({ regle: 'C', ou, quoi: 'transition: all' });
      const lourdes = props.filter((p) => p !== 'all' && !LEGERES.test(p) && !/^\d/.test(p) && !/^var\(/.test(p));
      if (lourdes.length && !permis) fautes.push({ regle: 'A', ou, quoi: `transition de ${lourdes.join(', ')}` });
      const longues = ms(valeur).filter((x, k) => k % 2 === 0 && x > 450);
      if (longues.length && !permis) fautes.push({ regle: 'F', ou, quoi: `transition de ${longues[0]} ms` });
    }
    const bf = l.match(/(?:^|[;{\s])backdrop-filter\s*:\s*([^;}]+)/);
    if (bf && !/^\s*none\b/.test(bf[1]) && !permis) fautes.push({ regle: 'D', ou, quoi: `backdrop-filter: ${bf[1].trim().slice(0, 40)}` });
    for (const a of l.matchAll(/(?:^|[;{\s])animation(?:-iteration-count)?\s*:\s*([^;}]+)/g)) {
      if (!/\binfinite\b/.test(a[1])) continue;
      // Les noms d'animation de la déclaration (chaque animation de la liste).
      const noms = a[1].split(',').map((x) => x.trim().split(/\s+/).find((mot) => /^[a-zA-Z][\w-]*$/.test(mot) && !/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|both|forwards|backwards|none|alternate|alternate-reverse|reverse|normal|paused|running|steps|step-start|step-end)$/.test(mot))).filter(Boolean);
      if (!permis) { fautes.push({ regle: 'E', ou, quoi: `animation sans fin ${noms.join(', ') || a[1].trim().slice(0, 40)}` }); continue; }
      // (un signe de travail sur une phrase ou trois points repeint ces mots-là, pas la page :
      // la lueur d'une phrase en cours et les points qui s'écrivent restent permis)
      for (const n of noms) {
        const kf = keyframes.get(n);
        if (kf && kf.props.some((p) => !/^(transform|translate|scale|rotate|opacity|content|background-position|--[\w-]+)$/.test(p))) fautes.push({ regle: 'E', ou, quoi: `signe de travail ${n} anime ${kf.props.join(', ')}` });
      }
    }
  });
  return { fautes, keyframes };
}

function verifier(transformer) {
  const toutes = [];
  for (const f of feuilles()) {
    let texte = fs.readFileSync(path.join(RACINE, f), 'utf8');
    if (transformer) texte = transformer(f, texte);
    toutes.push(...analyser(f, texte).fautes);
  }
  return toutes;
}

const CONTRE_PREUVES = {
  ombre: { regle: 'A', casse: (f, t) => (f === 'assets/pinlane.css' ? t + '\n.cp-ombre { transition: box-shadow 150ms ease; }\n' : t) },
  keyframes: { regle: 'B', casse: (f, t) => (f === 'assets/pinlane-staff.css' ? t + '\n@keyframes cpLueur { to { background-position: 100% 0; } }\n' : t) },
  tout: { regle: 'C', casse: (f, t) => (f === 'assets/pinlane-planning-global.css' ? t + '\n.cp-tout { transition: all 200ms; }\n' : t) },
  flou: { regle: 'D', casse: (f, t) => (f === 'assets/pinlane-staff.css' ? t + '\n.cp-flou { backdrop-filter: blur(6px); }\n' : t) },
  boucle: { regle: 'E', casse: (f, t) => (f === 'assets/pinlane-staff.css' ? t + '\n.cp-boucle::before { animation: pl-shimmer 1.5s ease-in-out infinite; }\n' : t) },
  lente: { regle: 'F', casse: (f, t) => (f === 'assets/pinlane.css' ? t + '\n.cp-lente { transition: opacity 900ms ease; }\n' : t) },
};

const arg = process.argv.find((a) => a.startsWith('--contre-preuves'));
if (arg) {
  const voulues = arg.includes('=') ? arg.split('=')[1].split(',') : Object.keys(CONTRE_PREUVES);
  let ko = 0;
  for (const nom of voulues) {
    const cp = CONTRE_PREUVES[nom];
    const fautes = verifier(cp.casse).filter((x) => x.regle === cp.regle && /cp-|cpLueur/.test(x.quoi + x.ou + JSON.stringify(x)) || x.regle === cp.regle);
    const avant = verifier(null).filter((x) => x.regle === cp.regle).length;
    const rougit = fautes.length > avant;
    console.log(`${rougit ? 'ok  ' : 'FAIL'}  contre-preuve ${nom} : la règle [${cp.regle}] ${rougit ? 'rougit' : 'NE ROUGIT PAS'} (${avant} -> ${fautes.length})`);
    if (!rougit) ko++;
  }
  process.exit(ko ? 1 : 0);
}

const fautes = verifier(null);
const parRegle = {};
for (const f of fautes) (parRegle[f.regle] = parRegle[f.regle] || []).push(f);
const TITRES = { A: 'transitions lourdes', B: 'keyframes lourdes', C: 'transition: all', D: 'flous d arrière-plan', E: 'animations sans fin', F: 'transitions trop longues' };
for (const r of 'ABCDEF') {
  const l = parRegle[r] || [];
  console.log(`${l.length ? 'FAIL' : 'ok  '}  [${r}] ${TITRES[r]} : ${l.length}`);
  for (const f of l.slice(0, process.argv.includes('--tout') ? 999 : 12)) console.log(`        ${f.ou}  ${f.quoi}`);
}
process.exit(fautes.length ? 1 : 0);
