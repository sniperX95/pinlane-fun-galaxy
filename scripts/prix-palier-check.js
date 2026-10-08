// LE PRIX AU-DELA DE LA GRILLE EST LE MEME AU SERVEUR ET DANS LA CONSOLE
// (gate ne le 2026-10-08, regle S2 de la fenetre Reserver).
//
// Regle validee par Movsar : le plus grand palier de la grille, puis l unite.
//   laser : 25 € les 3 parties, puis 10 € par partie en plus ;
//   bowling : 39 € l heure, plus 20 € la demi-heure.
// Le comptoir vend jusqu a 12 parties et 6 h de bowling (S1) : chaque quantite
// doit avoir UN prix, le meme dans lib/booking-config.js (serveur, ce qui se
// facture), dans la ligne de programme d une visite (lib/visit-program.js) et
// dans assets/booking-core.js (le jumeau navigateur, ce que la console
// affiche), charge tel quel dans un bac a sable vm.
//   [1] le serveur, au comptoir : 1 a 12 parties, 0,5 a 6 h ;
//   [2] le jumeau : les memes montants, et l option laser dit bien N parties ;
//   [3] la ligne de programme d une visite du comptoir porte le meme prix ;
//   [4] le tunnel public garde ses montants (sans palier, 2 h 30 vaut 0 et la
//       garde anti-abus le refuse ; 4 parties retombent sur la premiere option) ;
//   [5] contre-preuves par mutation : le gate rougit si l unite du laser, la
//       demi-heure du bowling ou l option composee du jumeau se cassent.
//
// Zero reseau, zero base. Lancement : node scripts/prix-palier-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://gate:gate@127.0.0.1:1/gate';
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.resolve(__dirname, '..');
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// Les mutations du serveur passent par la compilation (le disque n est jamais
// touche) ; celles du jumeau, par sa source avant le bac a sable.
let mutations = [];
const compileOrigine = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
  const rel = path.relative(ROOT, nom).split(path.sep).join('/');
  const editions = mutations.filter((e) => e.fichier === rel);
  if (!editions.length) return compileOrigine.call(this, contenu, nom);
  let mute = contenu.split(CRLF).join(LF);
  for (const { de, vers } of editions) {
    if (mute.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans ${rel} : ${de.slice(0, 70)}`);
    mute = mute.split(de).join(vers);
  }
  return compileOrigine.call(this, mute, nom);
};

function chargerServeur() {
  for (const cle of Object.keys(require.cache)) {
    if (cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`) && cle !== __filename) delete require.cache[cle];
  }
  return {
    config: require(path.join(ROOT, 'lib/booking-config.js')),
    programme: require(path.join(ROOT, 'lib/visit-program.js')),
  };
}

function chargerJumeau() {
  let source = fs.readFileSync(path.join(ROOT, 'assets/booking-core.js'), 'utf8').split(CRLF).join(LF);
  for (const { fichier, de, vers } of mutations) {
    if (fichier !== 'assets/booking-core.js') continue;
    if (source.split(de).length - 1 !== 1) throw new Error(`ancre absente ou multiple dans assets/booking-core.js : ${de.slice(0, 70)}`);
    source = source.split(de).join(vers);
  }
  const bac = { console };
  vm.createContext(bac);
  vm.runInContext(source, bac, { filename: 'assets/booking-core.js' });
  const coeur = bac.PinlaneBookingCore;
  if (!coeur) throw new Error('assets/booking-core.js ne s expose plus : PinlaneBookingCore absent.');
  return coeur;
}

// La regle ecrite une seconde fois, ici, en clair : ce que Movsar a valide.
const laserAttendu = (n) => (n <= 3 ? [0, 10, 18, 25][n] : 25 + (n - 3) * 10);
function bowlingAttendu(h) {
  const grille = { 0.5: 20, 1: 39, 1.5: 59, 2: 78 };
  if (grille[h] !== undefined) return grille[h];
  const reste = h - 2;
  return 78 + Math.floor(reste) * 39 + (reste % 1 ? 20 : 0);
}
const PARTIES = Array.from({ length: 12 }, (_, i) => i + 1);
const HEURES = Array.from({ length: 12 }, (_, i) => (i + 1) / 2);

// Les faits, mesures sur le code tel qu il est charge.
function mesurer() {
  const { config, programme } = chargerServeur();
  const jumeau = chargerJumeau();
  const options = { auPalier: true };
  const faits = { serveurLaser: {}, serveurBowling: {}, jumeauLaser: {}, jumeauBowling: {}, jumeauParties: {}, ligneLaser: {}, ligneBowling: {} };
  PARTIES.forEach((n) => {
    faits.serveurLaser[n] = config.getBasePrice('laser', n / 2, 0, 1, '', 'libramont', options);
    faits.jumeauLaser[n] = jumeau.getBasePrice('laser', n / 2, 0, 1, '');
    const option = jumeau.getLaserOption(n / 2);
    faits.jumeauParties[n] = `${option.games}|${jumeau.getLaserGameCount(n / 2)}|${option.label}`;
    const visite = programme.normalizeProgram([{ activityId: 'laser_game', games: n, participants: 4 }], { centerId: 'libramont', pax: 4, staff: true });
    const ligne = visite.items.find((item) => item.activityId === 'laser_game');
    faits.ligneLaser[n] = ligne ? `${ligne.games}|${ligne.price}` : 'absente';
  });
  HEURES.forEach((h) => {
    faits.serveurBowling[h] = config.getBasePrice('bowling', h, 1, 4, '', 'libramont', options);
    faits.jumeauBowling[h] = jumeau.getBasePrice('bowling', h, 1, 4, '');
    const visite = programme.normalizeProgram([{ activityId: 'bowling', duration: h, participants: 4 }], { centerId: 'libramont', pax: 4, staff: true, bowlingConfig: null });
    const ligne = visite.items.find((item) => item.activityId === 'bowling');
    faits.ligneBowling[h] = ligne ? `${ligne.duration}|${ligne.price}` : 'absente';
  });
  faits.publicBowling25 = config.getBasePrice('bowling', 2.5, 1, 4, '', 'libramont', {});
  faits.publicLaser4 = config.getBasePrice('laser', 2, 0, 1, '', 'libramont', {});
  faits.publicGrille = HEURES.filter((h) => h <= 2).map((h) => config.getBasePrice('bowling', h, 1, 4, '', 'libramont', {})).join(',');
  return faits;
}

function verifier(faits, sortie = true) {
  const notes = [];
  const verif = (cond, label) => { notes.push([Boolean(cond), label]); };
  verif(PARTIES.every((n) => faits.serveurLaser[n] === laserAttendu(n)),
    `[1] serveur, laser 1 a 12 parties : ${PARTIES.map((n) => faits.serveurLaser[n]).join(' ')}`);
  verif(HEURES.every((h) => faits.serveurBowling[h] === bowlingAttendu(h)),
    `[1] serveur, bowling 0,5 a 6 h par piste : ${HEURES.map((h) => faits.serveurBowling[h]).join(' ')}`);
  verif(PARTIES.every((n) => faits.jumeauLaser[n] === faits.serveurLaser[n]),
    `[2] jumeau = serveur pour le laser : ${PARTIES.map((n) => faits.jumeauLaser[n]).join(' ')}`);
  verif(HEURES.every((h) => faits.jumeauBowling[h] === faits.serveurBowling[h]),
    `[2] jumeau = serveur pour le bowling : ${HEURES.map((h) => faits.jumeauBowling[h]).join(' ')}`);
  verif(PARTIES.every((n) => faits.jumeauParties[n].startsWith(`${n}|${n}|`)),
    `[2] l option du jumeau dit N parties (4 : « ${faits.jumeauParties[4]} », 12 : « ${faits.jumeauParties[12]} »)`);
  verif(PARTIES.every((n) => faits.ligneLaser[n] === `${n}|${laserAttendu(n) * 4}`),
    `[3] ligne de visite laser, 4 joueurs : ${PARTIES.map((n) => faits.ligneLaser[n]).join(' ')}`);
  verif(HEURES.every((h) => faits.ligneBowling[h] === `${h}|${bowlingAttendu(h)}`),
    `[3] ligne de visite bowling, 1 piste : ${HEURES.map((h) => faits.ligneBowling[h]).join(' ')}`);
  verif(faits.publicBowling25 === 0, `[4] tunnel : 2 h 30 de bowling vaut toujours 0 (refuse par la garde anti-abus) : ${faits.publicBowling25}`);
  verif(faits.publicLaser4 === 10, `[4] tunnel : 4 parties retombent sur la premiere option, comme avant : ${faits.publicLaser4}`);
  verif(faits.publicGrille === '20,39,59,78', `[4] tunnel : la grille 0,5 a 2 h ne bouge pas : ${faits.publicGrille}`);
  if (sortie) notes.forEach(([cond, label]) => ok(cond, label));
  return notes;
}

function contrePreuve(nom, mutation, attendu) {
  mutations = [mutation];
  let rouges = [];
  try {
    rouges = verifier(mesurer(), false).filter(([cond]) => !cond).map(([, label]) => label);
  } catch (error) {
    rouges = [/ancre absente/.test(error.message) ? '' : `exception : ${error.message}`].filter(Boolean);
    if (!rouges.length) { mutations = []; ok(false, `contre-preuve « ${nom} » : ${error.message}`); return; }
  }
  mutations = [];
  ok(rouges.some((label) => attendu.test(label)), `contre-preuve « ${nom} » : le gate ROUGIT`, (rouges.find((label) => attendu.test(label)) || rouges[0] || 'aucune').slice(0, 160));
}

try {
  console.log('\n[1-4] LE PRIX AU PALIER, SERVEUR ET CONSOLE');
  verifier(mesurer());
  console.log('\n[5] CONTRE-PREUVES PAR MUTATION');
  contrePreuve('le laser compte la partie au prix du palier',
    { fichier: 'lib/prix-palier.js', de: '  return palier.price + (n - palier.games) * unite.price;', vers: '  return palier.price + (n - palier.games) * palier.price;' },
    /\[1\] serveur, laser/);
  contrePreuve('le jumeau compte la demi-heure au prix de l heure',
    { fichier: 'assets/booking-core.js', de: '  return palier.price + heuresPleines * heure.price + (avecDemi ? demi.price : 0);', vers: '  return palier.price + heuresPleines * heure.price + (avecDemi ? heure.price : 0);' },
    /\[2\] jumeau = serveur pour le bowling/);
  contrePreuve('le jumeau oublie l option composee (4 parties = 1 partie)',
    { fichier: 'assets/booking-core.js', de: '    || optionLaserAuPalier(options, Number(duration) * 2)\n', vers: '' },
    /\[2\] l option du jumeau dit N parties/);
  contrePreuve('le palier sert aussi le tunnel public',
    { fichier: 'lib/booking-config.js', de: '    if (prixGrille || !options.auPalier) return prixGrille * laneCount;', vers: '    if (prixGrille) return prixGrille * laneCount;' },
    /\[4\] tunnel : 2 h 30/);
} catch (error) {
  console.error('\nprix-palier-check ERREUR', error.stack || error.message);
  failures += 1;
}
if (failures) {
  console.error(`\nprix-palier-check: ${failures} FAIL`);
  process.exit(1);
}
console.log('\nprix-palier-check: ALL OK - un prix au-dela de la grille, le meme au serveur, dans la visite et dans la console.');
