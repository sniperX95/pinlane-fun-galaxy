// QUI PEUT EMBARQUER LE PARCOURS DE RESERVATION.
//
// Le tunnel client s'installe DANS le site de chaque client (iframe) : c'est le
// produit, pas une option. La directive `frame-ancestors` decide qui a le droit
// de l'encadrer. Elle vivait EN DUR dans vercel.json, donc chaque nouveau client
// demandait un deploiement pour que son site cesse d'afficher un cadre vide.
// Elle vient desormais de la variable EMBED_ORIGINS, lue par le middleware.
//
// Ce gate protege les trois proprietes qui comptent :
//   1. la directive n'est plus dans vercel.json - deux en-tetes CSP se cumulent
//      en INTERSECTION, la garder aux deux endroits figerait la liste et la
//      variable d'environnement ne servirait a rien (panne silencieuse : le
//      client ajoute son domaine, ca ne marche pas, et rien ne l'explique) ;
//   2. AUCUN passage autorise du middleware ne rend la main sans cet en-tete ;
//   3. une origine douteuse est REFUSEE : pas de http (un site non chiffre
//      encadrant un parcours de reservation), pas d'URL avec un chemin.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const MW = path.join(root, 'middleware.ts');
const VERCEL = path.join(root, 'vercel.json');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// La vraie fonction du middleware, executee telle quelle : recopier sa logique
// ici testerait ma copie, pas le code servi.
function runAncestors(envValue) {
  const src = fs.readFileSync(MW, 'utf8');
  const defaults = (src.match(/const DEFAULT_EMBED_ORIGINS = \[[^\]]*\];/) || [])[0];
  const start = src.indexOf('function embedAncestors()');
  const end = src.indexOf('function passThrough()');
  if (!defaults || start === -1 || end === -1) throw new Error('bloc embedAncestors introuvable dans middleware.ts');
  const body = src.slice(start, end).replace('function embedAncestors(): string {', 'function embedAncestors() {');
  const sandbox = { process: { env: envValue === null ? {} : { EMBED_ORIGINS: envValue } }, out: '' };
  vm.createContext(sandbox);
  vm.runInContext(`${defaults}\n${body}\nout = embedAncestors();`, sandbox);
  return sandbox.out;
}

// ===========================================================================
console.log('[1] La directive a bien quitte vercel.json');
// ===========================================================================
const vercelJson = fs.readFileSync(VERCEL, 'utf8');
ok(!vercelJson.includes('frame-ancestors'),
  'vercel.json ne fige plus frame-ancestors (sinon l intersection annule la variable)');
ok(vercelJson.includes("default-src 'self'"),
  'le reste de la politique de securite est intact dans vercel.json');

// ===========================================================================
console.log('\n[2] Aucun passage du middleware ne rend la main sans l en-tete');
// ===========================================================================
const mw = fs.readFileSync(MW, 'utf8');
const nuNext = (mw.match(/return next\(\);/g) || []).length;
ok(nuNext === 0, `aucun « return next() » nu (trouve ${nuNext})`);
ok((mw.match(/return passThrough\(\);/g) || []).length >= 4,
  'tous les chemins autorises passent par passThrough');
ok(/Content-Security-Policy/.test(mw), 'le middleware pose bien un en-tete de securite');

// ===========================================================================
console.log('\n[3] Ce que la liste accepte, et ce qu elle refuse');
// ===========================================================================
const base = runAncestors(null);
ok(base.startsWith("frame-ancestors 'self'"), 'la directive commence par self');
ok(base.includes('https://fungalaxy.be') && base.includes('https://www.mngfunglxy.com'),
  'sans variable, la liste historique est servie a l identique (rien ne casse au deploiement)');

const withClient = runAncestors('https://bowling-client.be, https://www.bowling-client.be');
ok(withClient.includes('https://bowling-client.be') && withClient.includes('https://www.bowling-client.be'),
  'un nouveau client s ajoute par variable d environnement, sans toucher au code');
ok(withClient.includes('https://fungalaxy.be'),
  'ajouter un client ne retire jamais les clients deja installes');

const hostile = runAncestors('http://pas-chiffre.be, https://avec.be/chemin, javascript:alert(1), *');
ok(!hostile.includes('http://pas-chiffre.be'), 'une origine en http clair est refusee');
ok(!hostile.includes('/chemin'), 'une URL avec un chemin est refusee (une origine n en a pas)');
ok(!hostile.includes('javascript:'), 'un pseudo-protocole est refuse');
ok(!/frame-ancestors[^;]*\*/.test(hostile), 'le joker n est jamais accepte');

// ===========================================================================
console.log('\n[4] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const original = fs.readFileSync(MW, 'utf8');
const anchor = ".filter((value) => /^https:\\/\\/[a-z0-9.-]+(:\\d+)?$/i.test(value));";
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue dans middleware.ts');
} else {
  fs.writeFileSync(MW, original.replace(anchor, '.filter(Boolean);'));
  let leaked = false;
  try {
    leaked = runAncestors('http://pas-chiffre.be').includes('http://pas-chiffre.be');
  } finally {
    fs.writeFileSync(MW, original); // restauration par edition inverse
  }
  ok(leaked, 'filtre neutralise : une origine http passe -> le gate ROUGIRAIT');
  ok(!runAncestors('http://pas-chiffre.be').includes('http://pas-chiffre.be'),
    'restauration inverse : le filtre refuse de nouveau le http');
}

if (failures) {
  console.error(`\nembed-origins-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nembed-origins-check: ALL OK - un client s installe par variable d environnement, et seules des origines https entieres sont acceptees.');
