// Prouve que la config centre éditable est corrélée au moteur déterministe,
// et que SANS override le comportement est byte-for-byte identique.
const assert = require('assert');
const { normalizeCenterConfig, mergeCenterConfig } = require('../lib/center-config');
const { getRequiredLaneCount, pairsForLaneCount, PAIRS } = require('../lib/booking-config');
const { getCenter, applyCenterOverrides } = require('../lib/ops-knowledge');

function testNormalizationBounds() {
  // Bornes : laneCount clampé, capacités cohérentes, statut validé.
  const cfg = normalizeCenterConfig(
    {
      status: 'bogus',
      resources: {
        bowling: { laneCount: 999, normalCapacityPerLane: 0, emergencyCapacityPerLane: 1 },
        laser: { weaponCount: -5, parallelLaunches: 0 },
      },
    },
    'libramont',
  );
  assert.strictEqual(cfg.resources.bowling.laneCount, 40, 'laneCount doit être clampé à 40');
  assert.ok(cfg.resources.bowling.normalCapacityPerLane >= 1, 'normalCapacity >= 1');
  assert.ok(
    cfg.resources.bowling.emergencyCapacityPerLane >= cfg.resources.bowling.normalCapacityPerLane,
    'emergency >= normal',
  );
  assert.strictEqual(cfg.resources.laser.weaponCount, 0, 'weaponCount négatif clampé à 0');
  assert.ok(cfg.resources.laser.parallelLaunches >= 1, 'parallelLaunches >= 1');
  assert.ok(['active', 'planned', 'closed'].includes(cfg.status), 'statut invalide → baseline');
}

function testMergeDoesNotMutate() {
  const base = { resources: { bowling: { laneCount: 8 }, laser: { weaponCount: 30 } } };
  const merged = mergeCenterConfig(base, { resources: { bowling: { laneCount: 12 } } });
  assert.strictEqual(base.resources.bowling.laneCount, 8, 'la base ne doit pas être mutée');
  assert.strictEqual(merged.resources.bowling.laneCount, 12, 'override appliqué');
  assert.strictEqual(merged.resources.laser.weaponCount, 30, 'les clés non touchées survivent');
}

function testEngineDefaultUnchanged() {
  // Sans override : 55 joueurs, 8 pistes, 7 max secours → capé à 8 pistes.
  assert.strictEqual(getRequiredLaneCount('bowling', 55), 8, 'défaut: 55 pax → 8 pistes');
  assert.strictEqual(getRequiredLaneCount('bowling', 6), 1, 'défaut: 6 pax → 1 piste');
  assert.strictEqual(getRequiredLaneCount('bowling', 13), 3, 'défaut: 13 pax → 3 pistes');
}

function testEngineOverrideCorrelates() {
  // Override laneCount=10 : 55 joueurs (≤ 10*7) → 10 pistes utilisables (pas 8).
  const bigConfig = { laneCount: 10, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 };
  assert.strictEqual(
    getRequiredLaneCount('bowling', 55, undefined, bigConfig),
    10,
    'override 10 pistes: 55 pax → 10',
  );
  // Override capacité/piste = 8 : 16 joueurs → 2 pistes (au lieu de 3 avec 6/piste).
  const roomyConfig = { laneCount: 8, normalCapacityPerLane: 8, emergencyCapacityPerLane: 9 };
  assert.strictEqual(
    getRequiredLaneCount('bowling', 16, undefined, roomyConfig),
    2,
    'override 8/piste: 16 pax → 2 pistes',
  );
}

function testPairsFollowLaneCount() {
  // Équivalence stricte à 8 pistes : paires générées = PAIRS historique.
  assert.deepStrictEqual(pairsForLaneCount(8), PAIRS, '8 pistes → PAIRS historique byte-for-byte');
  assert.deepStrictEqual(pairsForLaneCount(6), [[1, 2], [3, 4], [5, 6]], '6 pistes → 3 paires');
  assert.deepStrictEqual(pairsForLaneCount(7), [[1, 2], [3, 4], [5, 6]], 'impair : dernière piste sans binôme');
  assert.deepStrictEqual(pairsForLaneCount(12), [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]], '12 pistes → 6 paires');
  assert.deepStrictEqual(pairsForLaneCount(1), [], 'moins de 2 pistes → aucune paire');
  assert.deepStrictEqual(pairsForLaneCount('bogus'), [], 'valeur invalide → aucune paire');
}

function testGetCenterMerge() {
  // applyCenterOverrides doit refléter l'override dans getCenter, puis pouvoir
  // restaurer la baseline (map vide).
  applyCenterOverrides(new Map([['libramont', { resources: { bowling: { laneCount: 12 } } }]]));
  assert.strictEqual(
    Number(getCenter('libramont').resources.bowling.laneCount),
    12,
    'getCenter reflète l\'override',
  );
  applyCenterOverrides(new Map());
  assert.strictEqual(
    Number(getCenter('libramont').resources.bowling.laneCount),
    8,
    'baseline restaurée après clear',
  );
}

function main() {
  testNormalizationBounds();
  testMergeDoesNotMutate();
  testEngineDefaultUnchanged();
  testEngineOverrideCorrelates();
  testPairsFollowLaneCount();
  testGetCenterMerge();
  // Sécurité : laisser le module dans son état baseline pour les tests suivants.
  applyCenterOverrides(new Map());
  console.log('center-config-tests-ok');
}

main();
