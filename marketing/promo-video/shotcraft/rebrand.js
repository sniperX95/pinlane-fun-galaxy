// PASSE DE MARQUE : remplace les jetons « papier & encre » du template par ceux
// de Pinlane, dans tous les plans d'un coup.
//
// Pourquoi une passe scriptée et non douze éditions à la main : ces jetons sont
// des chaînes littérales répétées des dizaines de fois. Une substitution
// déclarée ici est AUDITABLE : le script compte chaque remplacement et refuse de
// finir s'il reste une couleur chaude, ce qui est la seule façon de savoir
// qu'aucune n'a survécu dans un coin.
//
// Les trois valeurs de marque sont relevées sur les fichiers de logo fournis
// (histogramme des pixels saturés), pas choisies à l'œil : voir la palette de
// `pinlane-site/index.html`.
//
// PIÈGE PAYÉ ICI : remplacer un littéral de chaîne AVEC ses délimiteurs par une
// valeur qui contient elle-même des apostrophes casse le fichier
// (`const SERIF = 'Geist', 'Geist Fallback', …;`). Les valeurs de police portent
// donc leurs propres guillemets doubles, et une passe de réparation rattrape les
// déclarations déjà cassées.
//
// Usage : node rebrand.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');

const BLEU = '#0664fe';        // le bleu du pictogramme et de « PIN »
const BLEU_CLAIR = '#1e74fe';  // la variante lisible sur fond sombre
const ENCRE = '#08111f';       // le texte : jamais noir pur, il porte le navy
const ATONE = '#55617a';
const SANS = `"'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif"`;
const MONO = `"'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace"`;
const OMBRE = (a) => `rgba(5, 30, 72, ${a})`;

// Reparation des declarations cassees par la premiere passe.
const REPARATIONS = [
  [`'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif;`,
    `"'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif";`],
  [`'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace;`,
    `"'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace";`],
  [`fontFamily: 'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif,`,
    `fontFamily: "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif",`],
  [`fontFamily: 'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace,`,
    `fontFamily: "'Geist Mono', 'Geist Mono Fallback', ui-monospace, SFMono-Regular, monospace",`],
];

const PAIRES = [
  // --- typographie (avec leurs delimiteurs, valeur en guillemets doubles) ---
  [`'ui-serif, Georgia, "Times New Roman", serif'`, SANS],
  [`'ui-monospace, SFMono-Regular, Menlo, monospace'`, MONO],
  [`'ui-sans-serif, system-ui, -apple-system, sans-serif'`, SANS],

  // --- encre, atone, accent ------------------------------------------------
  ['oklch(18% 0.006 82)', ENCRE],
  ['oklch(25% 0.006 82)', ENCRE],
  ['oklch(45% 0.006 82)', ATONE],
  ['oklch(50% 0.006 82)', ATONE],
  ['oklch(52% 0.115 65)', BLEU],
  ['oklch(58% 0.13 65)', BLEU],
  ['oklch(88% 0.095 85)', '#cfe0ff'],
  ['oklch(97.5% 0.008 82)', '#ffffff'],
  ['oklch(99.3% 0.014 88 / 0.85)', 'rgba(255, 255, 255, 0.92)'],
  ['oklch(90% .008 82)', 'rgba(5, 30, 72, 0.10)'],
  ['oklch(75% 0.08 85)', BLEU_CLAIR],       // poussiere doree -> poussiere bleue
  ['oklch(97% 0.028 85)', '#eef4ff'],
  ['oklch(95% 0.05 85)', '#e8f0ff'],

  // --- fonds ---------------------------------------------------------------
  ["'#f2eee6'", "'#f6f8fb'"],
  ["'#faf7f2'", "'#fafafa'"],
  ["'#fdfcfa'", "'#ffffff'"],
  ["'#f9f6f1'", "'#fafafa'"],
  ["'#fefcf9'", "'#ffffff'"],

  // --- lumieres : du chaud vers le froid ----------------------------------
  ['rgba(255,248,232,0.98)', 'rgba(255, 255, 255, 0.98)'],
  ['rgba(255,248,235,0.98)', 'rgba(255, 255, 255, 0.98)'],
  ['rgba(255,241,214,0.42)', 'rgba(226, 238, 255, 0.46)'],
  ['rgba(255,241,214,0.10)', 'rgba(226, 238, 255, 0.12)'],
  ['rgba(255,246,228,0.18)', 'rgba(232, 242, 255, 0.20)'],
  ['rgba(255,240,210,0.55)', 'rgba(190, 220, 255, 0.6)'],
  ['rgba(255,214,150,0.20)', 'rgba(30, 116, 254, 0.24)'],
  ['rgba(255,190,120,0.06)', 'rgba(30, 116, 254, 0.08)'],
  ['rgba(255,240,214,0.9)', 'rgba(235, 244, 255, 0.92)'],
  ['rgba(255,244,224,0)', 'rgba(255, 255, 255, 0)'],
  ['rgba(255,244,224,1)', 'rgba(255, 255, 255, 1)'],
  ['rgba(255,244,224,0.92)', 'rgba(255, 255, 255, 0.94)'],
  ['rgba(255,244,224,0.86)', 'rgba(255, 255, 255, 0.9)'],
  ['rgba(255,246,228,0.95)', 'rgba(255, 255, 255, 0.96)'],
  ['rgba(255,246,228,0.5)', 'rgba(255, 255, 255, 0.55)'],
  ['rgba(250,247,240,0.95)', 'rgba(255, 255, 255, 0.96)'],
  ['rgba(250,247,240,0)', 'rgba(255, 255, 255, 0)'],

  // --- ombres chaudes -> ombres navy --------------------------------------
  ['rgba(40,30,20,0.3)', OMBRE(0.3)],
  ['rgba(40,30,20,0.22)', OMBRE(0.22)],
  ['rgba(40,30,20,0.18)', OMBRE(0.18)],
  ['rgba(40,30,20,0.16)', OMBRE(0.16)],
  ['rgba(40,30,20,0.10)', OMBRE(0.1)],
  ['rgba(60,45,30,.08)', OMBRE(0.08)],
  ['rgba(60,45,30,.14)', OMBRE(0.14)],
  ['rgba(30,25,18,0.22)', OMBRE(0.22)],
  ['rgba(30,25,18,0.12)', OMBRE(0.12)],
  ['rgba(180,120,50,0.35)', 'rgba(6, 100, 254, 0.35)'],
  ['rgba(180,120,50,0.12)', 'rgba(6, 100, 254, 0.12)'],

  // --- metal de l'ouverture : noir de marque, pas gris-brun ---------------
  ['#2a2d33', '#0b1220'],
  ['#383c44', '#14203a'],
  ['#22242a', '#070d18'],
  ['#33363e', '#101b30'],
  ['#1d1f24', '#050a14'],
];

// Motifs a alpha calcule : on remplace la partie COULEUR, l'expression
// d'opacite reste intacte.
const REGEX = [
  [/rgba\(40,\s*30,\s*20,\s*\$\{/g, 'rgba(5, 30, 72, ${'],
  [/rgba\(60,\s*45,\s*30,\s*\$\{/g, 'rgba(5, 30, 72, ${'],
  [/rgba\(30,\s*25,\s*18,\s*\$\{/g, 'rgba(5, 30, 72, ${'],
  [/rgba\(180,\s*120,\s*50,\s*\$\{/g, 'rgba(6, 100, 254, ${'],
  [/rgba\(70,\s*56,\s*38,\s*\$\{/g, 'rgba(5, 30, 72, ${'],
];

const fichiers = [];
(function marcher(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) marcher(p);
    else if (/\.tsx?$/.test(e.name)) fichiers.push(p);
  });
})(SRC);

let total = 0;
fichiers.forEach((f) => {
  let s = fs.readFileSync(f, 'utf8');
  const avant = s;
  [...REPARATIONS, ...PAIRES].forEach(([de, vers]) => {
    let n = 0;
    while (s.includes(de)) { s = s.replace(de, vers); n++; if (n > 300) break; }
    total += n;
  });
  REGEX.forEach(([re, vers]) => {
    const m = s.match(re);
    if (m) { s = s.replace(re, vers); total += m.length; }
  });
  if (s !== avant) fs.writeFileSync(f, s);
});
console.log(`${total} remplacements dans ${fichiers.length} fichiers`);

// GARDE : une couleur est CHAUDE si son rouge depasse nettement son bleu. C'est
// une mesure, pas une liste de valeurs connues : la premiere version de cette
// garde signalait « rgba(226, 238, 255) » (un blanc bleute) comme chaude.
const restes = [];
fichiers.forEach((f) => {
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const nom = `${path.basename(f)}:${i + 1}`;
    [...l.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].forEach((m) => {
      const [r, v, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (r > b + 20 && v >= b) restes.push(`${nom} chaud rgb(${r},${v},${b})`);
    });
    // oklch a teinte 40-100 = jaune/orange/ambre
    [...l.matchAll(/oklch\([^)]*?\s(\d{2,3})(?:\s*\/|\s*\))/g)].forEach((m) => {
      const t = Number(m[1]);
      if (t >= 40 && t <= 110) restes.push(`${nom} oklch teinte ${t} : ${l.trim().slice(0, 70)}`);
    });
    if (/ui-serif|Georgia|Times New Roman/.test(l)) restes.push(`${nom} SERIF : ${l.trim().slice(0, 70)}`);
  });
});
if (restes.length) {
  console.log('\nRESTES CHAUDS OU SERIF :');
  restes.forEach((r) => console.log('  ' + r));
  process.exit(1);
}
console.log('OK : aucune couleur chaude ni serif ne subsiste');
