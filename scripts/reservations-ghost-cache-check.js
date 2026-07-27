// Fantomes du calendrier Reservations : le serveur fait AUTORITE dans sa fenetre.
//
// Incident (2026-07-27) : apres la purge complete de la base, la page
// Reservations affichait encore 24 resas / 393 joueurs / 4956 EUR, et les
// compteurs ne se corrigeaient qu'en cliquant sur chaque jour un par un.
//
// Cause : state.reservations est persiste en localStorage (save() serialise
// tout state), et les vues le fusionnaient avec la reponse serveur par simple
// UNION d'id. Une union ne peut jamais RETIRER une ligne : chaque rendu
// ressuscitait des reservations que le serveur ne renvoyait plus. Seul le clic
// sur un jour appelait replaceReservationsForDate, qui nettoyait CETTE date -
// d'ou la correction progressive, jour par jour, constatee par Movsar.
//
// Ce gate verrouille la regle qui remplace l'union : dans la fenetre servie, ce
// que le serveur ne renvoie pas n'existe plus. Deux exceptions legitimes sont
// testees explicitement (hors fenetre, mutation locale en vol) parce qu'une
// regle trop stricte ferait clignoter les creations optimistes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const APP = path.join(root, 'assets/app-main.js');
let failures = 0;

function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

// Extrait une fonction par son en-tete jusqu'a son accolade fermante de colonne 0.
// Insensible au style de fin de ligne : le repo vit en CRLF sur Windows et en
// LF ailleurs, une recherche de '\n}\n' echouerait sur la moitie des machines.
function extractFunction(src, header) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  const match = /\r?\n\}\r?\n/.exec(src.slice(start));
  return match ? src.slice(start, start + match.index + match[0].length) : null;
}

// Execute la VRAIE fonction du fichier, avec un contexte minimal.
function runKeep({ local, server, windowStart, windowEnd, pending = [] }) {
  const src = fs.readFileSync(APP, 'utf8'); // relecture : les mutations doivent etre vues
  const body = extractFunction(src, 'function keepLocalWithinServerAuthority(');
  if (!body) throw new Error('keepLocalWithinServerAuthority introuvable dans app-main.js');
  const sandbox = {
    pendingReservationMutations: new Map(pending.map((id) => [String(Number(id)), {}])),
    getReservationWriteKey: (id) => String(Number(id)),
    out: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${body}\nout = keepLocalWithinServerAuthority(${JSON.stringify(local)}, ${JSON.stringify(server)}, ${JSON.stringify(windowStart)}, ${JSON.stringify(windowEnd)});`,
    sandbox,
  );
  return sandbox.out;
}

const W = ['2026-06-01', '2026-08-02']; // fenetre type du calendrier (mois precedent -> fin de grille)
const r = (id, date) => ({ id, date, name: `r${id}` });

// ===========================================================================
console.log('[1] La regle elle-meme');
// ===========================================================================

// LE cas de l'incident : purge cote serveur, cache local encore plein.
const purged = runKeep({ local: [r(1, '2026-07-10'), r(2, '2026-07-11'), r(3, '2026-07-23')], server: [], windowStart: W[0], windowEnd: W[1] });
ok(purged.length === 0,
  `base purgee : aucune resa locale ne survit dans la fenetre (obtenu ${purged.length}, attendu 0)`);

// Hors fenetre, le serveur ne s'est pas prononce : on ne supprime rien.
const outside = runKeep({ local: [r(10, '2026-05-04'), r(11, '2026-09-15')], server: [], windowStart: W[0], windowEnd: W[1] });
ok(outside.length === 2,
  `hors fenetre : le local est conserve (obtenu ${outside.length}, attendu 2)`);

// Bornes incluses : une resa pile sur la borne est DANS la fenetre.
const edges = runKeep({ local: [r(20, W[0]), r(21, W[1])], server: [], windowStart: W[0], windowEnd: W[1] });
ok(edges.length === 0, 'les bornes de la fenetre sont inclusives (rien ne fuit par les bords)');

// Une creation optimiste ne doit pas clignoter le temps de l'aller-retour.
const optimistic = runKeep({ local: [r(30, '2026-07-12'), r(31, '2026-07-12')], server: [], windowStart: W[0], windowEnd: W[1], pending: [30] });
ok(optimistic.length === 1 && String(optimistic[0].id) === '30',
  'une mutation locale en vol survit, sa voisine sans mutation disparait');

// Connue du serveur : conservee (l'union fera gagner la version voulue).
const known = runKeep({ local: [r(40, '2026-07-15')], server: [r(40, '2026-07-15')], windowStart: W[0], windowEnd: W[1] });
ok(known.length === 1, 'une resa presente cote serveur reste dans la liste');

// Robustesse : une entree sans date ne doit pas passer au travers de la regle.
const noDate = runKeep({ local: [{ id: 50, name: 'sans date' }], server: [], windowStart: W[0], windowEnd: W[1] });
ok(noDate.length === 1, 'une entree sans date est traitee comme hors fenetre (pas de suppression a l aveugle)');

// ===========================================================================
console.log('\n[2] La regle est CABLEE dans les deux vues (pas seulement definie)');
// ===========================================================================
const src = fs.readFileSync(APP, 'utf8');
for (const fn of ['getStaffReservationsSourceReservations', 'getStaffClientSourceReservations']) {
  const body = extractFunction(src, `function ${fn}(`);
  ok(!!body && body.includes('keepLocalWithinServerAuthority('),
    `${fn} applique l autorite serveur avant de fusionner`);
}
// Aucune vue ne doit refaire l union brute avec state.reservations.
const rawUnions = (src.match(/mergeReservationsById\(\[[^\]]*state\.reservations[^\]]*\]\)/g) || []);
ok(rawUnions.length === 0,
  `aucune union brute avec state.reservations ne subsiste (${rawUnions.length} trouvee(s))`);

// ===========================================================================
console.log('\n[3] CONTRE-PREUVE par mutation (ce gate sait-il rougir ?)');
// ===========================================================================
function toFileEol(text, original) {
  return original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}

const original = fs.readFileSync(APP, 'utf8');
const rawAnchor = '    if (inWindow) return true;';
const anchorNeutralize = toFileEol('    if (!inWindow) return true;', original);
const replacement = toFileEol('    if (true) return true;', original);
const count = original.split(anchorNeutralize).length - 1;
if (count !== 1) {
  ok(false, `ancre de mutation introuvable ou ambigue (${count})`);
} else {
  fs.writeFileSync(APP, original.replace(anchorNeutralize, replacement));
  let survived = true;
  try {
    survived = runKeep({ local: [r(1, '2026-07-10')], server: [], windowStart: W[0], windowEnd: W[1] }).length === 0;
  } finally {
    fs.writeFileSync(APP, original); // restauration par EDITION INVERSE
  }
  ok(!survived, 'garde de fenetre neutralisee : le fantome revient, le gate ROUGIRAIT');
  ok(runKeep({ local: [r(1, '2026-07-10')], server: [], windowStart: W[0], windowEnd: W[1] }).length === 0,
    'restauration inverse : le fantome disparait de nouveau');
}

if (failures) {
  console.error(`\nreservations-ghost-cache-check: FAIL ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nreservations-ghost-cache-check: ALL OK - le serveur fait autorite dans sa fenetre.');
