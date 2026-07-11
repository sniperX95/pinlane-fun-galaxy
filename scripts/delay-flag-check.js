// Vérifie les helpers PURS du flag de retard (lib/delay-flag.js) : cumul des
// minutes (+5 puis +10 => +15), conservation de l'heure d'origine + du snapshot
// pré-décalage, reset après clear, et masquage sans toucher l'horaire.
// Couvre les deux bugs signalés : badge non cumulatif + revert au bon créneau.
const assert = require('assert');
const { stampDelayFlag, clearDelayFlagOnPlan } = require('../lib/delay-flag');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (error) { failures += 1; console.error(`  FAIL ${name}\n       ${error.message}`); }
}

console.log('delay-flag-check');

// 1. Premier retard : minutes = delta, from = origine, origin snapshotté, le
//    plan DÉJÀ décalé (resourceBlocks) est conservé tel quel.
check('premier retard: pose minutes + from + origin, conserve le plan décalé', () => {
  const originPlan = { startTime: '14:00', resourceBlocks: [{ start: 840, end: 900 }] };
  const shiftedPlan = { startTime: '14:05', resourceBlocks: [{ start: 845, end: 905 }] };
  const out = stampDelayFlag(shiftedPlan, {
    minutes: 5, from: '14:00', to: '14:05',
    existingFlag: null,
    origin: { startTime: '14:00', opsPlan: originPlan, lanes: [3] },
  });
  assert.strictEqual(out.delayFlag.minutes, 5, 'minutes = 5');
  assert.strictEqual(out.delayFlag.from, '14:00', 'from = origine');
  assert.strictEqual(out.delayFlag.to, '14:05');
  assert.strictEqual(out.delayFlag.cleared, false);
  assert.ok(out.delayFlag.origin, 'origin snapshotté');
  assert.strictEqual(out.delayFlag.origin.startTime, '14:00');
  assert.deepStrictEqual(out.delayFlag.origin.opsPlan, originPlan, 'origin porte le plan pré-décalage');
  assert.deepStrictEqual(out.resourceBlocks, shiftedPlan.resourceBlocks, 'plan décalé conservé');
});

// 2. Deuxième retard : CUMUL (+5 puis +10 = +15), heure d'origine + snapshot
//    PRÉSERVÉS (l'origine recalculée sur l'état déjà décalé est ignorée).
check('deuxième retard: cumule les minutes, préserve from + origin', () => {
  const firstFlag = {
    minutes: 5, from: '14:00', to: '14:05',
    origin: { startTime: '14:00', opsPlan: { startTime: '14:00' }, lanes: [3] },
    cleared: false,
  };
  const shiftedAgain = { startTime: '14:15', resourceBlocks: [{ start: 855, end: 915 }] };
  const out = stampDelayFlag(shiftedAgain, {
    minutes: 10, from: '14:05', to: '14:15',
    existingFlag: firstFlag,
    origin: { startTime: '14:05', opsPlan: { startTime: '14:05' }, lanes: [3] },
  });
  assert.strictEqual(out.delayFlag.minutes, 15, 'cumul 5 + 10 = 15 (badge +15, pas +10)');
  assert.strictEqual(out.delayFlag.from, '14:00', "heure d'origine préservée (pas 14:05)");
  assert.strictEqual(out.delayFlag.to, '14:15', 'to = dernière heure');
  assert.strictEqual(out.delayFlag.origin.startTime, '14:00', 'origin préservé du 1er retard');
});

// 3. Après clear, un nouveau retard REPART de zéro (flag cleared ignoré).
check('après clear: nouveau retard repart de zéro', () => {
  const clearedFlag = { minutes: 15, from: '14:00', to: '14:15', origin: { startTime: '14:00' }, cleared: true };
  const out = stampDelayFlag({ startTime: '14:20' }, {
    minutes: 5, from: '14:00', to: '14:05',
    existingFlag: clearedFlag,
    origin: { startTime: '14:00', opsPlan: { startTime: '14:00' }, lanes: [3] },
  });
  assert.strictEqual(out.delayFlag.minutes, 5, 'repart à 5 (flag cleared ignoré)');
  assert.strictEqual(out.delayFlag.cleared, false);
});

// 4. clearDelayFlagOnPlan marque cleared sans toucher l'horaire.
check('clearDelayFlagOnPlan: marque cleared, plan intact', () => {
  const plan = { startTime: '14:15', delayFlag: { minutes: 15, cleared: false } };
  const { plan: out, changed } = clearDelayFlagOnPlan(plan);
  assert.strictEqual(changed, true);
  assert.strictEqual(out.delayFlag.cleared, true);
  assert.strictEqual(out.startTime, '14:15', 'horaire inchangé');
});

// 5. clearDelayFlagOnPlan sans flag = no-op.
check('clearDelayFlagOnPlan: no-op si pas de flag', () => {
  const { changed } = clearDelayFlagOnPlan({ startTime: '14:00' });
  assert.strictEqual(changed, false);
});

if (failures) { console.error(`\ndelay-flag-check: ${failures} FAILED`); process.exit(1); }
console.log('\ndelay-flag-check: ALL OK');
