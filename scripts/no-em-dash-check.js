// Garde-fou typographique : le tiret cadratin (U+2014) et le tiret
// demi-cadratin (U+2013) sont bannis de tout le SaaS.
//
// Deux raisons, pas une :
//  1. Decision produit (Movsar, 2026-07-16) : on n'en veut nulle part, ni dans
//     l'UI, ni dans les prompts, ni dans le code.
//  2. Consequence technique : ces caracteres sont le marqueur numero 1 d'un
//     texte ecrit par une IA. Le modele recopie ce qu'il voit dans son prompt.
//     Un seul tiret cadratin qui traine dans un exemple canonique et l'agent en
//     produit dans les posts publies.
//
// Sans ce test, ils reviennent a la premiere generation de code.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Exclus : dependances, build, clones tiers en lecture seule, et .firecrawl
// (donnees scrapees brutes = preuve, on ne la reecrit pas).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vercel', '.agents', '.firecrawl',
  '_mkdev', 'dist', 'build', '.next', 'coverage',
]);
const SKIP_FILES = new Set(['package-lock.json', 'no-em-dash-check.js']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.sql']);

const BANNED = [
  { char: '—', name: 'tiret cadratin (em dash)' },
  { char: '–', name: 'tiret demi-cadratin (en dash)' },
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else if (EXT.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

const hits = [];
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { char, name } of BANNED) {
      if (!line.includes(char)) continue;
      hits.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: i + 1, name, text: line.trim().slice(0, 90) });
    }
  });
}

if (hits.length) {
  console.error(`no-em-dash-check: ${hits.length} tiret(s) interdit(s).\n`);
  for (const h of hits.slice(0, 30)) {
    console.error(`  ${h.file}:${h.line}  ${h.name}\n    ${h.text}`);
  }
  if (hits.length > 30) console.error(`\n  ... et ${hits.length - 30} autres.`);
  console.error('\nRemplace par : virgule, deux-points, parenthese, point, ou trait d\'union.');
  process.exit(1);
}

console.log('no-em-dash-check: ALL OK (zero tiret cadratin, zero tiret demi-cadratin)');
