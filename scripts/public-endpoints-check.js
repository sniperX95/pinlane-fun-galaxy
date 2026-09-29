// Les endpoints du parcours CLIENT sont joignables SANS identifiants.
//
// Incident (2026-07-28, remonte par Movsar) : en envoyant une « demande sur
// mesure » (groupe, entreprise, privatisation), le client recevait la fenetre
// « Se connecter » du navigateur. Cause : /api/custom-request manquait dans les
// publicPaths de middleware.ts. Le middleware repondait 401 avec un en-tete
// WWW-Authenticate, donc le navigateur ouvrait sa boite d'authentification -
// devant un client qui n'a evidemment aucun identifiant. La demande ne partait
// jamais.
//
// La rewrite vercel.json ne sauve pas : sur Vercel le middleware s'execute AVANT
// les rewrites, il voit donc le chemin d'origine.
//
// Ce gate liste les endpoints que le parcours public appelle et verifie qu'ils
// sont tous dans la liste blanche. Un nouvel endpoint public ajoute au tunnel
// sans etre declare ici et dans le middleware fera rougir la CI, pas le client.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const MIDDLEWARE = path.join(root, 'middleware.ts');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Ce que le CLIENT (non authentifie) appelle : tunnel de reservation, demande
// sur mesure, landing pro, sonde de sante.
const PUBLIC_FLOW_ENDPOINTS = [
  ['/api/public-booking-meta', 'catalogue, horaires et verdict du jour'],
  ['/api/public-availability', 'creneaux disponibles'],
  ['/api/public-reservations', 'creation de la reservation'],
  ['/api/public-holds', 'blocage des horaires choisis pendant les coordonnees'],
  ['/api/custom-request', 'demande sur mesure (groupe, entreprise, privatisation)'],
  ['/api/pilot-lead', 'formulaire de la landing pro'],
  ['/api/healthz', 'sonde de sante'],
];

function readPublicPaths(source) {
  const start = source.indexOf('const publicPaths = new Set([');
  if (start === -1) return null;
  const end = source.indexOf(']);', start);
  if (end === -1) return null;
  // Les commentaires sont retires AVANT de lire les chaines : une apostrophe
  // francaise dans un commentaire (« d'identifiants ») ouvrait une fausse
  // chaine et avalait l'entree suivante. Le gate declarait alors absent un
  // chemin bel et bien present - un faux rouge, pire qu'un faux vert.
  const block = source.slice(start, end).replace(/^\s*\/\/.*$/gm, '');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const original = fs.readFileSync(MIDDLEWARE, 'utf8');
const declared = readPublicPaths(original);

if (!declared || !declared.length) {
  console.error('public-endpoints-check: publicPaths introuvable dans middleware.ts');
  process.exit(1);
}
console.log(`[1] ${declared.length} chemins publics declares dans middleware.ts\n`);

PUBLIC_FLOW_ENDPOINTS.forEach(([endpoint, why]) => {
  ok(declared.includes(endpoint), `${endpoint} joignable sans identifiants (${why})`);
});

// Le parcours client ne doit pas non plus dependre d'un chemin qui n'existe pas
// cote fichiers ou rewrites : un endpoint public declare mais non servi
// renverrait 404 au client.
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const rewrites = (vercel.rewrites || []).map((r) => r.source);
PUBLIC_FLOW_ENDPOINTS.forEach(([endpoint]) => {
  const served = fs.existsSync(path.join(root, `${endpoint.slice(1)}.js`)) || rewrites.includes(endpoint);
  ok(served, `${endpoint} est reellement servi (fichier api/ ou rewrite)`);
});

// ===========================================================================
console.log('\n[2] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
const toFileEol = (text) => (original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));
const anchor = toFileEol("    '/api/custom-request',");
if ((original.split(anchor).length - 1) !== 1) {
  ok(false, 'ancre de mutation introuvable ou ambigue');
} else {
  fs.writeFileSync(MIDDLEWARE, original.replace(anchor, toFileEol("    // '/api/custom-request',")));
  let detected = false;
  try {
    const mutated = readPublicPaths(fs.readFileSync(MIDDLEWARE, 'utf8')) || [];
    detected = !mutated.includes('/api/custom-request');
  } finally {
    fs.writeFileSync(MIDDLEWARE, original); // restauration par edition inverse
  }
  ok(detected, 'endpoint retire de la liste blanche : detecte -> le gate ROUGIRAIT');
  ok((readPublicPaths(fs.readFileSync(MIDDLEWARE, 'utf8')) || []).includes('/api/custom-request'),
    'restauration inverse : la liste blanche est intacte');
}

// LES DEUX CHEMINS DE public-booking-meta LISENT-ILS LE MEME NOM DE CENTRE ?
//
// Cet endpoint a DEUX entrees : une sonde d etat (embedState) et le catalogue.
// La sonde acceptait `center` ou `centerId`, le catalogue seulement `centerId`,
// et retombait EN SILENCE sur libramont. Mesure en production le 2026-09-08 :
// ?center=gembloux rendait 200 avec les PRIX de Libramont. Aucun visiteur
// n etait touche (le tunnel envoie centerId), mais embed.js met bien `center=`
// dans l adresse du cadre : la premiere integration qui recopiait ce nom
// servait les tarifs du mauvais client. Un ecart de tarif ne se voit sur aucun
// ecran, seulement en caisse.
{
  const META = path.join(root, 'api', 'public-booking-meta.js');
  const source = fs.readFileSync(META, 'utf8');
  // Chaque lecture du centre depuis l URL, avec les noms qu elle accepte.
  const lectures = [];
  // La capture va jusqu au point-virgule : un motif qui s arrete a la premiere
  // parenthese fermante ne verrait que la PREMIERE des deux lectures, et
  // declarerait manquante une alternative pourtant presente.
  const motif = /const\s+(?:centerId|demande)\s*=\s*String\(([^;]*);/g;
  let trouve;
  while ((trouve = motif.exec(source)) !== null) {
    const expression = trouve[1];
    lectures.push({
      centerId: expression.includes("get('centerId')"),
      center: expression.includes("get('center')"),
    });
  }
  // MONTAGE : sans les deux lectures, l assertion suivante ne mesure rien.
  if (ok(lectures.length >= 2,
    `MONTAGE : les deux lectures du centre sont trouvees dans public-booking-meta (${lectures.length})`)) {
    const toutes = lectures.every((l) => l.centerId && l.center);
    ok(toutes,
      'les deux chemins de public-booking-meta acceptent center ET centerId (pas de repli silencieux sur un autre client)');
  }
}

if (failures) {
  console.error(`\npublic-endpoints-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\npublic-endpoints-check: ALL OK - aucun endpoint du parcours client derriere une authentification.');
