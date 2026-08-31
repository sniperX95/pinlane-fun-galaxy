// UN CENTRE SANS ENTREPRISE NE VEND PAS LE CATALOGUE D'UN AUTRE.
//
// Mesure du 2026-09-01 (sonde + refutation independante) : un centre present
// nulle part dans la carte centre->entreprise (et meme un id invente) resolvait
// vers la portee PLATEFORME et se voyait servir les 14 formules du socle Fun
// Galaxy, a leurs vrais prix (f1 a 26 EUR...). Or l'orphelin n'est pas une vue
// de l'esprit : upsertCenter (le chemin de creation par la console) n'ecrit
// JAMAIS client_id ; seul provisionClient le pose. Un clic d'admin suffit donc
// a creer un centre qui facturerait sous la marque et la grille d'un autre.
// Aucun orphelin en prod aujourd'hui (verifie par GET sur les 4 centres) : le
// defaut etait latent, ce gate le rend impossible.
//
// LA NUANCE QUI COMPTE (fail-soft preserve) : quand la carte centre->entreprise
// est VIDE (demarrage a froid, panne base), TOUT LE MONDE lit le socle
// plateforme ; c'est le repli documente de loadCatalogState (« appauvri mais
// jamais fuyant » : personne d'autre n'existe alors non plus). La garde ne
// mord que quand la carte est CHARGEE et que le centre n'y est pas.
//
// Proprietes :
//   A. MONTAGE : carte chargee, libramont (fungalaxy) voit ses 14 formules.
//   B. LE DEFAUT : un centre HORS carte ne voit AUCUNE formule ; un id invente
//      non plus.
//   C. FAIL-SOFT : carte vide, le socle plateforme continue de servir tout le
//      monde (le demarrage a froid de la prod reste intact).
//   D. La portee plateforme elle-meme (appels sans centre) ne bouge pas.
//
// Contre-epreuve par mutation : on retire la portee orpheline, B doit rougir,
// restauration a l'identique.
//
// Lancement : node scripts/orphan-center-scope-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, 'lib', 'catalog-store.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function main() {
  const store = require(STORE);
  const { buildSeedRows } = require(path.join(ROOT, 'scripts', 'backfill-catalog.js'));
  const seed = buildSeedRows();
  const socle = { formulas: seed.formulas, steps: seed.steps, activities: seed.activities };

  // --- A. MONTAGE : carte chargee -------------------------------------------
  store.applyCatalogState({ ...socle, centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }] });
  const libramont = store.listBookingFormules('libramont');
  ok(libramont.length === 14, `montage : libramont (entreprise fungalaxy) voit ses formules (${libramont.length}/14)`);

  // --- B. LE DEFAUT : centre hors carte -------------------------------------
  const orphelin = store.listBookingFormules('orphancenter');
  ok(orphelin.length === 0,
    `un centre SANS entreprise ne vend rien (${orphelin.length} formule(s)${orphelin.length ? `, dont ${orphelin[0].id} a ${orphelin[0].price} EUR : le catalogue Fun Galaxy fuit` : ''})`);
  const invente = store.listBookingFormules('nexiste-pas');
  ok(invente.length === 0, `un id de centre invente ne vend rien non plus (${invente.length})`);

  // --- C. FAIL-SOFT : carte vide --------------------------------------------
  store.applyCatalogState({ ...socle, centerClients: [] });
  const froid = store.listBookingFormules('orphancenter');
  ok(froid.length === 14,
    `carte centre->entreprise VIDE (demarrage a froid / panne base) : le socle plateforme sert encore (${froid.length}/14, fail-soft documente preserve)`);

  // --- D. La portee plateforme ne bouge pas ---------------------------------
  store.applyCatalogState({ ...socle, centerClients: [{ id: 'libramont', client_id: 'fungalaxy' }] });
  const plateforme = store.listBookingFormules();
  ok(plateforme.length === 14, `appel sans centre (portee plateforme) : inchange (${plateforme.length}/14)`);

  if (failures) {
    console.error(`\norphan-center-scope-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\norphan-center-scope-check: ALL OK (un centre sans entreprise ne vend pas le catalogue d un autre)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(STORE, 'utf8');
  const marqueur = '  if (dbState.centerClients.size > 0) return ORPHAN_CENTER_SCOPE;';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : la portee orpheline est introuvable dans lib/catalog-store.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, '  // mutation contre-epreuve : orphelin -> plateforme, comme avant');
  fs.writeFileSync(STORE, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(STORE, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec la portee orpheline retiree.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : retirer la portee orpheline fait rougir le gate.');
  process.exit(0);
}

main();
