// LE TAUX D'OCCUPATION NE PEUT PAS DEPASSER 100 %.
//
// Pendant deux sessions, l'ecran affichait « Taux d'occupation 813 % » pour
// 13 reservations d'une heure sur 8 pistes, et ce chiffre a ete pris pour un
// bug de calcul du produit. Il ne l'etait pas : le produit compte les durees en
// HEURES (`duration: 1`), et c'est la fixture du mode demonstration qui les
// donnait en MINUTES (`duration: 60`). 13 x 60 / (8 pistes x 12 h) = 8,13.
//
// La lecon n'est pas « corriger la fixture ». C'est que le systeme accepte les
// deux unites sans le dire : `readBlockHour` normalise deja minutes -> heures
// pour les HORAIRES (`raw > 24 ? raw / 60 : raw`), preuve que des valeurs en
// minutes circulent. Le chemin de repli des fenetres bowling, lui, prenait
// `reservation.duration` brut. N'importe quelle donnee en minutes arrivant par
// la reproduisait le meme facteur 60 - cette fois en production.
//
// Ce gate protege trois choses :
//   1. `readDurationHours` normalise reellement (fonction extraite du fichier
//      servi, pas une copie : recopier la logique testerait ma copie) ;
//   2. le chemin de repli l'utilise, au lieu de lire `duration` brut ;
//   3. aucune combinaison d'entrees plausible ne produit un taux > 100 %.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const CORE = path.join(root, 'assets', 'booking-core.js');
const DEMO = path.join(root, 'assets', 'demo-mode.js');
const APP = path.join(root, 'assets', 'app-main.js');
let failures = 0;

function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ->  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// La VRAIE fonction du fichier servi, executee telle quelle.
function loadReadDurationHours() {
  const src = fs.readFileSync(CORE, 'utf8');
  const start = src.indexOf('function readDurationHours(');
  if (start === -1) throw new Error('readDurationHours introuvable dans booking-core.js');
  const end = src.indexOf('\n}', start) + 2;
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${src.slice(start, end)}\nthis.f = readDurationHours;`, sandbox);
  return sandbox.f;
}

const readDurationHours = loadReadDurationHours();

console.log('\n-- la normalisation des durees --');
ok(readDurationHours(1) === 1, 'une duree de 1 (heure) reste 1 h');
ok(readDurationHours(2) === 2, 'une duree de 2 (heures) reste 2 h');
ok(readDurationHours(1.5) === 1.5, 'une duree fractionnaire reste intacte');
ok(readDurationHours(60) === 1, 'une duree de 60 (minutes) devient 1 h', readDurationHours(60) + ' h');
ok(readDurationHours(90) === 1.5, 'une duree de 90 (minutes) devient 1,5 h', readDurationHours(90) + ' h');
ok(readDurationHours(30) === 0.5, 'une duree de 30 (minutes) devient 0,5 h', readDurationHours(30) + ' h');
ok(readDurationHours(0) === 0, 'une duree nulle vaut 0');
ok(readDurationHours(undefined) === 0, 'une duree absente vaut 0, pas NaN');
ok(readDurationHours(-3) === 0, 'une duree negative vaut 0');

console.log('\n-- le chemin de repli utilise la normalisation --');
const core = fs.readFileSync(CORE, 'utf8');
const repli = core.slice(core.indexOf("if (resourceType === 'bowling_lane' && (reservation.lanes"), core.indexOf("if (resourceType === 'laser_arena' && (reservation.type === 'formule'"));
ok(/readDurationHours\(reservation\.duration\)/.test(repli), 'le repli bowling normalise la duree');
ok(!/duration:\s*Number\(reservation\.duration\)/.test(repli), 'le repli ne lit plus la duree brute');
ok(/end:\s*timeToNum\(reservation\.startTime\)\s*\+\s*heures/.test(repli), "l'heure de fin utilise la meme duree normalisee");

console.log('\n-- la formule reste piste-heures sur capacite --');
const app = fs.readFileSync(APP, 'utf8');
ok(/const bowlingCapacity = TOTAL_LANES \* openHours;/.test(app), 'la capacite = pistes x heures ouvertes');
ok(/const occupancy = bowlingCapacity \? Math\.round\(\(laneHours \/ bowlingCapacity\) \* 100\) : 0;/.test(app),
  "le taux = piste-heures / capacite, et vaut 0 quand le centre est ferme");

console.log('\n-- aucune entree plausible ne depasse 100 % --');
// On rejoue le calcul complet du tableau de bord avec la duree normalisee.
// 8 pistes, 12 h d'ouverture : la journee la plus chargee possible est 96
// piste-heures, soit 100 %. Rien ne doit passer au-dessus.
const PISTES = 8;
const OUVERTURE = 12;
function taux(reservations) {
  const laneHours = reservations.reduce((sum, r) => sum + readDurationHours(r.duration) * Math.max((r.lanes || []).length, 1), 0);
  return Math.round((laneHours / (PISTES * OUVERTURE)) * 100);
}
const treizeHeures = Array.from({ length: 13 }, (_, i) => ({ duration: 1, lanes: [(i % 8) + 1] }));
const treizeMinutes = Array.from({ length: 13 }, (_, i) => ({ duration: 60, lanes: [(i % 8) + 1] }));
ok(taux(treizeHeures) === 14, '13 reservations d une heure = 14 %', taux(treizeHeures) + ' %');
ok(taux(treizeMinutes) === 14, 'les memes, exprimees en minutes, donnent le meme taux', taux(treizeMinutes) + ' %');
ok(taux(treizeMinutes) <= 100, "le chiffre de 813 % n'est plus atteignable", taux(treizeMinutes) + ' %');
// Le cas plein : 8 pistes occupees 12 h d'affilee.
const plein = Array.from({ length: 8 }, (_, i) => ({ duration: 12, lanes: [i + 1] }));
ok(taux(plein) === 100, 'une journee entierement reservee vaut exactement 100 %', taux(plein) + ' %');

console.log('\n-- la fixture du mode demonstration parle la meme langue --');
const demo = fs.readFileSync(DEMO, 'utf8');
// On lit le CODE, pas les commentaires. La premiere version de ce gate prenait
// la premiere occurrence de `duration:` dans le bloc et tombait sur celle citee
// dans le commentaire juste au-dessus : le gate restait vert avec la fixture
// mutee. Trouve par la contre-preuve, pas par relecture.
const bloc = demo.slice(demo.indexOf('function reservations()'), demo.indexOf('var DEMO ='))
  .split('\n')
  .filter((ligne) => !ligne.trim().startsWith('//'))
  .join('\n');
// La fixture n'ecrit plus un litteral apres `duration:` : elle CALCULE ses
// durees (var duree = ... ? 2 : 1) puis cable `duration: duree`. Le gate
// verifie donc la meme propriete sur les deux formes : le champ est cable, et
// TOUTE valeur candidate est en heures plausibles. Un retour aux minutes
// (`? 30 : 60`, ou `duration: 60`) fait rougir, exactement comme avant.
const cable = /duration:\s*(?:duree\b|[\d.]+)/.test(bloc);
ok(cable, 'la fixture declare une duree (litteral ou variable cablee)');
const valeursDuree = [...bloc.matchAll(/duree\s*=\s*[^;]*?([\d.]+)\s*:\s*([\d.]+)/g)]
  .flatMap((m) => [Number(m[1]), Number(m[2])])
  .concat([...bloc.matchAll(/duration:\s*([\d.]+)/g)].map((m) => Number(m[1])));
ok(valeursDuree.length > 0 && valeursDuree.every((v) => v > 0 && v <= 12),
  'la fixture exprime la duree en heures, comme le produit', 'valeurs: ' + valeursDuree.join(', '));

console.log(failures === 0 ? '\nOK : le taux d occupation ne peut plus mentir.' : `\n${failures} echec(s).`);
process.exit(failures === 0 ? 0 : 1);
