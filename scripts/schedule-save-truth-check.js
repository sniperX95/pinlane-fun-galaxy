// UNE SAISIE D HORAIRE REFUSEE NE DOIT PAS DEVENIR UN SILENCE.
//
// Deux saisies tres ordinaires suffisent a perdre une journee de vente :
//   (a) le gerant ecrit la nuit comme il la dit, "22:00 -> 02:00" (le code
//       attend 26:00, pas 02:00) ;
//   (b) il tape l heure d ouverture et enregistre avant d avoir fini la
//       fermeture, donc close vaut la chaine vide.
//
// Dans les deux cas normalizeDaySchedule rendait `undefined`, et
// normalizeScheduleBlock SUPPRIMAIT purement la cle du jour au lieu de refuser.
// La sauvegarde repondait "Configuration enregistree" sans un mot. La cle
// absente n ecrasant plus rien, la fusion retombait sur la baseline : la
// console affichait le jour "Ferme" pendant que le tunnel public continuait de
// vendre l ANCIEN horaire. Deux verites opposees dans le meme produit, et
// personne pour le dire au gerant.
//
// Trois proprietes :
//   A. Un horaire valide s enregistre, inchange.
//   B. Une saisie invalide sur un jour PRESENT est REFUSEE, avec un message qui
//      nomme le jour et dit la regle. Elle n est jamais silencieusement ignoree.
//   C. Un jour ABSENT du patch reste intact : la correction partielle (ne
//      toucher qu au samedi) doit continuer de marcher.
//
// Puis une CONTRE-EPREUVE par mutation : on remet la suppression silencieuse,
// on prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/schedule-save-truth-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'lib/center-config.js');
const { normalizeCenterConfig } = require(CONFIG);

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function essai(regular) {
  try {
    const out = normalizeCenterConfig({ defaultSchedule: { regular } }, undefined, { strict: true });
    const bloc = out && out.defaultSchedule && out.defaultSchedule.regular ? out.defaultSchedule.regular : {};
    return { refuse: false, jours: Object.keys(bloc), bloc };
  } catch (error) {
    return { refuse: true, message: String(error.message || ''), expose: Boolean(error.expose) };
  }
}

function main() {
  // --- A. Un horaire valide passe -----------------------------------------
  const valide = essai({ 6: { open: '10:00', close: '24:00' } });
  ok(!valide.refuse && valide.bloc['6'] && valide.bloc['6'].open === '10:00' && valide.bloc['6'].close === '24:00',
    `un samedi 10:00-24:00 s enregistre tel quel (${JSON.stringify(valide.bloc && valide.bloc['6'])})`);

  // Une nuit qui deborde s ecrit bien au-dela de 24:00.
  const nuit = essai({ 5: { open: '14:00', close: '26:00' } });
  ok(!nuit.refuse && nuit.bloc['5'] && nuit.bloc['5'].close === '26:00',
    `un vendredi 14:00-26:00 (nuit qui deborde) s enregistre (${JSON.stringify(nuit.bloc && nuit.bloc['5'])})`);

  // --- B. Une saisie invalide est REFUSEE, pas avalee ---------------------
  const minuitPasse = essai({ 6: { open: '22:00', close: '02:00' } });
  ok(minuitPasse.refuse,
    `"22:00 -> 02:00" est refuse au lieu d etre efface en silence (${minuitPasse.refuse ? minuitPasse.message.slice(0, 80) : 'ACCEPTE, jours retenus : ' + JSON.stringify(minuitPasse.jours)})`);
  ok(minuitPasse.refuse && /samedi/i.test(minuitPasse.message),
    `le message nomme le jour fautif (${minuitPasse.refuse ? minuitPasse.message.slice(0, 90) : 'aucun message'})`);
  ok(minuitPasse.refuse && minuitPasse.expose === true,
    'le message est destine au gerant (error.expose)');

  const fermetureVide = essai({ 3: { open: '12:00', close: '' } });
  ok(fermetureVide.refuse,
    `une fermeture laissee vide est refusee (${fermetureVide.refuse ? fermetureVide.message.slice(0, 70) : 'ACCEPTEE, jours : ' + JSON.stringify(fermetureVide.jours)})`);

  const identique = essai({ 2: { open: '14:00', close: '14:00' } });
  ok(identique.refuse,
    `une fermeture egale a l ouverture est refusee (${identique.refuse ? 'refusee' : 'ACCEPTEE'})`);

  // --- C. Un jour ABSENT du patch reste intact ----------------------------
  const partiel = essai({ 6: { open: '11:00', close: '23:00' } });
  ok(!partiel.refuse && partiel.jours.length === 1 && partiel.jours[0] === '6',
    `une correction partielle ne porte QUE le jour touche (${JSON.stringify(partiel.jours)})`);

  // Un jour explicitement ferme (null) reste une valeur legitime.
  const ferme = essai({ 1: null });
  ok(!ferme.refuse && ferme.bloc['1'] === null,
    `un lundi explicitement ferme (null) reste accepte (${JSON.stringify(ferme.bloc && ferme.bloc['1'])})`);

  // --- D. LA LECTURE RESTE TOLERANTE -------------------------------------
  // La severite ne vaut que sur la SAUVEGARDE. Une ligne deja stockee avec un
  // jour bancal doit continuer de se charger : sinon un enregistrement ancien
  // fermerait la console au lieu d afficher ce qu il peut.
  let lecture = 'jetee';
  try {
    const out = normalizeCenterConfig({ defaultSchedule: { regular: { 6: { open: '22:00', close: '02:00' } } } });
    lecture = JSON.stringify(Object.keys((out.defaultSchedule || {}).regular || {}));
  } catch (error) { lecture = `jetee : ${error.message.slice(0, 40)}`; }
  ok(lecture === '[]',
    `en LECTURE (sans strict) la meme donnee ne jette pas, elle est juste ignoree (${lecture})`);

  if (failures) {
    console.error(`\nschedule-save-truth-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nschedule-save-truth-check: ALL OK (une saisie refusee le dit, un jour absent reste intact)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(CONFIG, 'utf8');
  const marqueur = 'throw scheduleError(day);';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : la garde attendue est introuvable dans lib/center-config.js');
    process.exit(1);
  }
  // On remet la suppression silencieuse d avant.
  const mute = source.replace(marqueur, 'continue;');
  fs.writeFileSync(CONFIG, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(CONFIG, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec la suppression silencieuse.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : la suppression silencieuse fait rougir le gate ; module restaure a l identique.');
  process.exit(0);
}

main();
