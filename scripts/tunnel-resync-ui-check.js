// Gate UI du chantier de resynchronisation (2026-09-19).
//
// Il verrouille trois contrats visibles :
//   1. la racine publique presente Pinlane avant de demander une action ;
//   2. /reserver et les anciens deep-links staff/admin restent distincts ;
//   3. un groupe sans creneau dispose d'une vraie sortie vers la demande sur
//      mesure deja branchee a /api/custom-request.
//
// Chaque famille possede une contre-epreuve : on retire le marqueur de
// production dans une copie en memoire et le meme controle doit rougir.
// Lancement : node scripts/tunnel-resync-ui-check.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const files = {
  html: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  js: fs.readFileSync(path.join(ROOT, 'assets', 'app-main.js'), 'utf8'),
  css: fs.readFileSync(path.join(ROOT, 'assets', 'pinlane-client.css'), 'utf8'),
};

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
  return Boolean(ok);
}

function inspect(source) {
  const entry = /id="entryView"/.test(source.html)
    && /href="\/reserver"/.test(source.html)
    && /href="\/#\/staff\/planning"/.test(source.html)
    && /shouldShowPublicEntry/.test(source.js)
    && /showPublicEntry/.test(source.js);
  const routes = /isClientRoutePath\(getCurrentPathname\(\)\)/.test(source.js)
    && /\['client', 'staff', 'admin'\]/.test(source.js)
    && /CLIENT_ROUTE_PATH\s*=\s*'\/reserver'/.test(source.js);
  const blockedExit = /slot-state-actions/.test(source.js)
    && /openCustomRequestModal\(\)/.test(source.js)
    && /Demander une proposition/.test(source.js);
  const responsive = /\.entry-view/.test(source.css)
    && /@media\s*\(max-width:\s*640px\)/.test(source.css)
    && /\.booking-facts/.test(source.css)
    && /\.contact-confidence/.test(source.css);
  return { entry, routes, blockedExit, responsive };
}

const result = inspect(files);
check(result.entry, 'la racine porte une presentation avec acces reservation et equipe');
check(result.routes, '/reserver et les deep-links historiques gardent leur contrat');
check(result.blockedExit, 'zero creneau propose la demande sur mesure branchee');
check(result.responsive, 'la finition tunnel couvre entree, syntheses et contact responsive');

const mutations = [
  ['entree retiree', { ...files, html: files.html.replace('id="entryView"', 'id="entryViewRetiree"') }, 'entry'],
  ['route client retiree', { ...files, js: files.js.replace("const CLIENT_ROUTE_PATH = '/reserver';", "const CLIENT_ROUTE_PATH = '/booking';") }, 'routes'],
  ['sortie sur mesure retiree', { ...files, js: files.js.replace('Demander une proposition', 'Contacter') }, 'blockedExit'],
  ['synthese chiffres retiree', { ...files, css: files.css.replaceAll('.booking-facts', '.facts-retiree') }, 'responsive'],
];

for (const [label, source, key] of mutations) {
  check(!inspect(source)[key], `contre-epreuve : ${label} fait rougir le gate`);
}

if (failures) {
  console.error(`\ntunnel-resync-ui-check: ${failures} echec(s)`);
  process.exit(1);
}
console.log('\ntunnel-resync-ui-check: ok');
