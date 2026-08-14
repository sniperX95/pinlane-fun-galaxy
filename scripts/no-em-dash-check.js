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
//
// `database` est exclu pour une raison de fond, pas par confort : ces fichiers
// sont des MIGRATIONS DEJA APPLIQUEES. Leur checksum est scelle en base et
// l'immutabilite est ce qui garantit qu'une migration jouee en prod ne peut
// plus changer sous nos pieds. Y toucher, meme pour un tiret dans un
// commentaire, casse le runner (constate le 2026-07-16 : la purge a modifie 9
// schemas et plus aucune migration ne passait). Ces tirets ne sortent nulle
// part : ils vivent dans des commentaires SQL, jamais dans l'UI ni dans un
// prompt. Une nouvelle migration, elle, doit etre ecrite sans tiret.
// 'artifacts' : dossier de SORTIE (gitignore) - backups de base, captures, logs
// de diagnostic. Ce sont des DONNEES, pas du code : un backup de production
// contient forcement le texte tel que les utilisateurs l'ont saisi, tirets
// compris. Le scanner reviendrait a interdire un caractere aux clients.
// (Constate le 2026-07-27 : un backup de purge a fait rougir ce gate avec
// 41 tirets provenant de notes de reservation.)
// `vendor` : du code TIERS repris tel quel, sous sa propre licence. La regle du
// tiret cadratin porte sur ce que Pinlane ECRIT (son interface, ses textes, ses
// commits), pas sur une dependance qu'on ne modifie pas. Y toucher pour faire
// passer un gate reviendrait a maintenir un fork d'un fichier qu'on a
// justement choisi de ne pas maintenir, et a perdre la garantie qu'il est
// identique a l'original publie.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.vercel', '.agents', '.firecrawl',
  '_mkdev', 'dist', 'build', '.next', 'coverage', 'database', 'artifacts',
  'vendor',
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
