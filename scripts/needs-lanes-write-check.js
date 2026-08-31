// LE BESOIN EN PISTES SE DECIDE A L'ECRITURE COMME A LA LECTURE.
//
// Mesure du 2026-08-31, la nuit avant l'ouverture Fun Galaxy Libramont.
//
// La question « cette reservation a-t-elle besoin de pistes ? » a deux
// reponses dans le code :
//   - la LECTURE (lib/booking-config.js reservationNeedsLanes) lit le
//     CATALOGUE VIVANT : hasBowling derive des steps du store, une formule
//     custom creee en live compte comme une historique. Gate en place :
//     scripts/catalog-crud-check.js check 2.
//   - l'ECRITURE (lib/database.js, normalizeReservationPayload) repondait avec
//     un Set FIGE de six ids (f1, f3, f4, bts, css, ffm), en ignorant le
//     payload. Toute formule bowling creee apres ce Set passait sans piste :
//     laneCount force a 0, lanes videes, AUCUN verrou anti-double-piste.
//
// Dans un centre a 4000 EUR par jour, c'est un groupe sans piste a l'arrivee
// ou une piste vendue deux fois, des la premiere formule custom avec bowling
// (createFormula + setFormulaSteps, accessibles en live avec settings.manage).
//
// Quatre proprietes :
//   A. MONTAGE : le store est amorce (socle reel + une formule custom
//      'qa-noctambule' au step bowling clone de f1) et la LECTURE voit son
//      besoin en pistes. Prouve que le gate mesure avant de croire son rouge.
//   B. LE DEFAUT : l'ECRITURE dit PAREIL que la lecture pour la formule
//      custom : pistes conservees, laneCount calcule.
//   C. NON-REGRESSION : pour les formules du socle, l'ecriture repond
//      exactement comme la lecture (six avec pistes, les autres sans).
//   D. Les autres types ne bougent pas : bowling -> pistes ; laser -> jamais ;
//      activite avec requiresLanes -> pistes.
//
// Contre-epreuve par mutation : on refige la branche formule de database.js
// sur le Set historique, le gate doit rougir sur B, restauration a l'identique.
//
// Lancement : node scripts/needs-lanes-write-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'lib', 'database.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function main() {
  const store = require(path.join(ROOT, 'lib', 'catalog-store.js'));
  const bc = require(path.join(ROOT, 'lib', 'booking-config.js'));
  const db = require(DB);
  const { buildSeedRows } = require(path.join(ROOT, 'scripts', 'backfill-catalog.js'));

  // --- Amorcage : socle reel + une formule custom avec step bowling ---------
  const seed = buildSeedRows();
  const modele = seed.formulas.find((row) => row.id === 'f1');
  const stepBowling = seed.steps.find((row) => row.formula_id === 'f1' && row.activity_id === 'bowling');
  if (!modele || !stepBowling) {
    console.error('FAIL  socle illisible : f1 ou son step bowling introuvable dans buildSeedRows()');
    process.exit(1);
  }
  const custom = { ...modele, id: 'qa-noctambule', name: 'QA Noctambule', source: 'custom' };
  const customStep = { ...stepBowling, formula_id: 'qa-noctambule', position: 1 };
  store.applyCatalogState({
    formulas: [...seed.formulas, custom],
    steps: [...seed.steps, customStep],
    activities: seed.activities,
  });

  const basePayload = {
    name: 'QA Gate', phone: '0470000000', date: '2026-09-06', startTime: '14:00',
    duration: 120, pax: 8, centerId: 'libramont', channel: 'public',
  };
  const normalize = (extra) => db.normalizeReservationPayload({ ...basePayload, ...extra });

  // --- A. Le montage mesure : la LECTURE voit la formule custom -------------
  ok(bc.reservationNeedsLanes('formule', 'f1') === true,
    'montage : la lecture (booking-config) voit le besoin en pistes de f1');
  ok(bc.reservationNeedsLanes('formule', 'qa-noctambule') === true,
    'montage : la lecture voit le besoin en pistes de la formule custom (store amorce)');
  ok(bc.reservationNeedsLanes('formule', 'f2') === false,
    'montage : la lecture ne donne pas de pistes a f2 (sans bowling)');

  // --- B. L ECRITURE dit pareil pour la formule custom ----------------------
  const sansPistes = normalize({ type: 'formule', formuleId: 'qa-noctambule' });
  ok(sansPistes.laneCount >= 1,
    `formule custom bowling : l ecriture calcule ses pistes (laneCount=${sansPistes.laneCount}, attendu >= 1 pour 8 joueurs)`);
  const avecPistes = normalize({ type: 'formule', formuleId: 'qa-noctambule', lanes: [3, 4], laneCount: 2 });
  ok(avecPistes.laneCount === 2 && avecPistes.lanes.length === 2,
    `formule custom bowling : les pistes choisies survivent a l ecriture (laneCount=${avecPistes.laneCount}, lanes=[${avecPistes.lanes}])`);

  // --- C. Parite ecriture/lecture sur tout le socle -------------------------
  let ecarts = [];
  for (const formule of bc.FORMULES) {
    const lecture = bc.reservationNeedsLanes('formule', formule.id);
    const payload = normalize({ type: 'formule', formuleId: formule.id, lanes: [3, 4], laneCount: 2 });
    const ecriture = payload.laneCount > 0;
    if (lecture !== ecriture) ecarts.push(`${formule.id} (lecture=${lecture}, ecriture=${ecriture})`);
  }
  ok(ecarts.length === 0,
    `socle : l ecriture repond comme la lecture pour les ${bc.FORMULES.length} formules (${ecarts.join(', ') || 'zero ecart'})`);

  // --- D. Les autres types ne bougent pas -----------------------------------
  const bowling = normalize({ type: 'bowling' });
  ok(bowling.laneCount >= 1, `type bowling : pistes calculees (laneCount=${bowling.laneCount})`);
  const laser = normalize({ type: 'laser', lanes: [1, 2], laneCount: 2 });
  ok(laser.laneCount === 0 && laser.lanes.length === 0, 'type laser : jamais de piste, meme fournies');
  const activite = normalize({ type: 'activite', requiresLanes: true, lanes: [5], laneCount: 1 });
  ok(activite.laneCount === 1 && activite.lanes.length === 1, 'type activite + requiresLanes : pistes conservees');
  const libre = normalize({ type: 'activite' });
  ok(libre.laneCount === 0, 'type activite sans besoin declare : zero piste (le centre absorbe)');

  if (failures) {
    console.error(`\nneeds-lanes-write-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nneeds-lanes-write-check: ALL OK (l ecriture verrouille les pistes que la lecture promet)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(DB, 'utf8');
  const marqueur = "if (payload.type === 'formule' && payload.formuleId) return catalogFormuleNeedsLanes('formule', payload.formuleId);";
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : la branche formule vivante est introuvable dans lib/database.js');
    process.exit(1);
  }
  // On refige le Set historique : la formule custom repasse sans piste.
  const mute = source.replace(marqueur,
    "if (payload.type === 'formule' && payload.formuleId) return new Set(['f1', 'f3', 'f4', 'bts', 'css', 'ffm']).has(payload.formuleId);");
  fs.writeFileSync(DB, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(DB, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert avec le Set refige.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : refiger le Set fait rougir le gate.');
  process.exit(0);
}

main();
