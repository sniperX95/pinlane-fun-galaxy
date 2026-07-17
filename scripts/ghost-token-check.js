// Tokens fantomes : tout var(--x) reference dans assets/*.css doit pointer
// vers un token DECLARE quelque part dans assets/*.css (ou porter un fallback
// qui pointe vers un token declare).
//
// Ne du RUN C de AUDIT-MARKETING.md : le bloc plan referencait var(--ink),
// var(--font-mono) et var(--ok), declares NULLE PART : le lisere de confiance
// (seul vecteur du signal) rendait la meme couleur pour tous les tons, et
// aucun gate ne le voyait. Le grep manuel etait le faux vert n°1 rejoue : un
// grep sur echantillon vide retourne 0 et « prouve » zero probleme.
//
// Regles :
// - ECHEC si l'echantillon est vide (aucun fichier, aucun var(), aucune
//   declaration) : un ensemble vide satisfait toutes les assertions.
// - ECHEC sur tout var(--x) dont le token n'est declare nulle part et dont le
//   fallback (s'il existe) ne retombe pas sur un token declare ou une valeur
//   litterale.
// - Les tokens declares sont collectes dans TOUS les assets/*.css : les alias
//   de compat historiques (pinlane-staff.css:30-64) sont declares, donc leurs
//   usages LEGACY passent ; ils restent interdits en code neuf par la revue,
//   pas par ce gate (les purger partout est un chantier a part).
// Preuve d'echec sur echantillon vide :
//   node scripts/ghost-token-check.js <dossier-vide>  ->  exit 1
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'assets');

function fail(message) {
  console.error(`ghost-token-check: FAIL ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssDir)) fail(`dossier introuvable: ${cssDir}`);
const files = fs.readdirSync(cssDir).filter((name) => name.endsWith('.css')).map((name) => path.join(cssDir, name));
if (files.length < 2) fail(`echantillon vide ou trop petit (${files.length} fichier(s) .css dans ${cssDir})`);

const declared = new Set();
const usages = [];
let totalBytes = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  totalBytes += content.length;
  const base = path.basename(file);
  // Declarations : `--token:` en debut de propriete.
  for (const match of content.matchAll(/(^|[{;\s])(--[a-z0-9-]+)\s*:/gi)) {
    declared.add(match[2]);
  }
  // Usages : var(--token) avec fallback optionnel (capture non gourmande).
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/gi)) {
      usages.push({ file: base, line: index + 1, token: match[1], fallback: (match[2] || '').trim() });
    }
  });
}

if (totalBytes < 50000) fail(`echantillon trop petit (${totalBytes} octets) : ce n'est pas le vrai dossier assets`);
if (!declared.size) fail('aucune declaration de token trouvee (echantillon vide)');
if (!usages.length) fail('aucun usage var() trouve (echantillon vide)');

function fallbackResolves(fallback) {
  if (!fallback) return false;
  // Fallback vers un autre var(...) : il resout si SON token est declare (ou
  // si son propre fallback est une valeur litterale).
  const inner = fallback.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i);
  if (inner) return declared.has(inner[1]) || fallbackResolves((inner[2] || '').trim());
  // Valeur litterale (couleur, taille, mot-cle) : elle resout par definition.
  return true;
}

const ghosts = usages.filter((usage) => !declared.has(usage.token) && !fallbackResolves(usage.fallback));

if (ghosts.length) {
  for (const ghost of ghosts.slice(0, 20)) {
    console.error(`  fantome  ${ghost.file}:${ghost.line}  var(${ghost.token})${ghost.fallback ? ` fallback "${ghost.fallback}"` : ''}`);
  }
  fail(`${ghosts.length} usage(s) de token jamais declare. Un token fantome rend silencieusement la valeur initiale de la propriete.`);
}

console.log(`ghost-token-check: ALL OK (${files.length} fichiers, ${declared.size} tokens declares, ${usages.length} usages verifies, 0 fantome)`);
