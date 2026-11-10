// LA GRAINE DES DUREES, REFAITE DEPUIS UN PASSAGE GITHUB (2026-11-10).
//
// Le lanceur coupe la suite en parts egales d apres scripts/gates-durees.json
// (gates-lancer.js, `repartir`). Une unite absente de la graine y compte pour
// 60 s (navigateur) ou 8 s : un gate neuf de dix minutes est alors range comme
// s il en durait une, et sa part deborde. Le 2026-11-09, les six tiers de
// contre-preuves de l assistant (neuf minutes chacun, absents de la graine)
// ont ete ranges dans la meme part : 54 a 60 minutes pour une limite a 60, la
// part annulee, la suite a rejouer. Ce jour-la, 72 unites sur 496 manquaient
// et les durees connues dataient du 2026-10-30 ; avec les durees mesurees, la
// part la plus longue passe de 17 min 28 s a 14 min 12 s a nombre de parts egal.
//
// Ce script relit le bilan rassemble d un passage (bilan-assemble.json, que
// scripts/suite-github.js rapatrie et dont il affiche le dossier) et recopie
// dans la graine la duree de chaque unite VERTE. Une unite rouge, instable ou
// sautee garde sa duree d avant : son temps de ce passage ne dit rien. Rien
// n est jamais retire de la graine.
//
// D OU REFAIRE LA GRAINE (2026-11-10). La suite d avant mise en ligne ne joue
// pas les contre-preuves, et un gate qui lit PINLANE_SANS_CONTRE_PREUVES y est
// plus court que la nuit (demandes-console : 75 s au lieu de 440). La graine
// sert d abord cette suite-la, celle que les sessions attendent : la refaire
// depuis un passage suite-tout-<sha>. Un passage de nuit ou suite-preuves-<sha>
// ne sert qu a mesurer les unites de contre-preuves ; ecrit tel quel, il
// rallongerait dans la graine les gates que la suite courte abrege.
//
// Usage : node scripts/gates-graine.js <bilan-assemble.json ou son dossier> [--ecrire]
//   sans --ecrire : dit ce qui changerait, n ecrit rien.
'use strict';
const fs = require('fs');
const path = require('path');
const commun = require('./gates-commun');

const ROOT = commun.ROOT;
const GRAINE = path.join(ROOT, 'scripts', 'gates-durees.json');

// Les durees mesurees d un bilan, par cle d unite (`script#rang`). Le bilan
// range les unites par part : le rang se retrouve par la commande.
function dureesDuBilan(bilan, scripts) {
  const mesurees = {};
  let ignorees = 0;
  for (const s of bilan.scripts || []) {
    const rangs = new Map(commun.unites(s.nom, scripts).map((u) => [u.commande, u.rang]));
    for (const u of s.unites || []) {
      if (u.etat !== 'VERT' || !rangs.has(u.commande) || !Number.isFinite(u.ms)) { ignorees += 1; continue; }
      mesurees[`${s.nom}#${rangs.get(u.commande)}`] = Math.round(u.ms / 100) / 10;
    }
  }
  return { mesurees, ignorees };
}

function fusionner(graine, mesurees) {
  const neuve = { ...graine, ...mesurees };
  return Object.fromEntries(Object.keys(neuve).sort().map((cle) => [cle, neuve[cle]]));
}

function principal() {
  const args = process.argv.slice(2);
  const ecrire = args.includes('--ecrire');
  let source = args.find((a) => !a.startsWith('--'));
  if (!source) { console.error('Usage : node scripts/gates-graine.js <bilan-assemble.json ou son dossier> [--ecrire]'); process.exit(2); }
  if (fs.statSync(source).isDirectory()) source = path.join(source, 'bilan-assemble.json');
  const bilan = JSON.parse(fs.readFileSync(source, 'utf8'));
  const brut = fs.readFileSync(GRAINE, 'utf8');
  const graine = JSON.parse(brut);
  const { mesurees, ignorees } = dureesDuBilan(bilan, commun.scriptsNpm(ROOT));
  const neuve = fusionner(graine, mesurees);
  const cles = Object.keys(mesurees);
  const ajoutees = cles.filter((cle) => graine[cle] === undefined);
  const ecarts = cles.filter((cle) => graine[cle] !== undefined).map((cle) => ({ cle, avant: graine[cle], apres: mesurees[cle] })).sort((a, b) => Math.abs(b.apres - b.avant) - Math.abs(a.apres - a.avant));
  const somme = (o, liste) => Math.round(liste.reduce((a, cle) => a + (o[cle] || 0), 0) / 60);
  console.log(`[graine] ${cles.length} unites vertes relues, ${ignorees} laissees (rouges, instables, sautees ou commande changee).`);
  console.log(`[graine] ${ajoutees.length} unites sans duree jusqu ici : ${somme(mesurees, ajoutees)} min mesurees, comptees pour 60 s ou 8 s chacune.`);
  console.log(`[graine] unites deja connues : ${somme(graine, ecarts.map((e) => e.cle))} min dans la graine, ${somme(mesurees, ecarts.map((e) => e.cle))} min mesurees.`);
  [...ajoutees.map((cle) => ({ cle, avant: null, apres: mesurees[cle] })).sort((a, b) => b.apres - a.apres).slice(0, 6), ...ecarts.slice(0, 8)]
    .forEach((e) => console.log(`[graine]   ${e.cle.padEnd(38)} ${e.avant === null ? 'absente' : `${e.avant} s`} -> ${e.apres} s`));
  if (!ecrire) { console.log('[graine] rien d ecrit (ajoutez --ecrire).'); return; }
  const texte = `${JSON.stringify(neuve, null, 1)}\n`;
  fs.writeFileSync(GRAINE, brut.includes('\r\n') ? texte.replace(/\n/g, '\r\n') : texte);
  console.log(`[graine] scripts/gates-durees.json ecrit : ${Object.keys(neuve).length} cles.`);
}

if (require.main === module) principal();
module.exports = { dureesDuBilan, fusionner };
