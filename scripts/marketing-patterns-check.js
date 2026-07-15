// Boucle d'apprentissage marketing (2026-07-16) — tests PURS (sans DB).
// Prouve : effet NET vs baseline (G1), agrégation par contexte (G2),
// réinjection déterministe (G3). Ajouté au gate marketing.
const assert = require('assert');
const {
  computeNetInsightMeasurement,
  buildPatternRows,
  rankCandidatesByPatterns,
  patternContextKey,
} = require('../lib/center-metrics');

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ok —', name); }

// ── G1 : effet net vs baseline ───────────────────────────────────────────────

check('effet net simple (+20 % au-dessus de la baseline)', () => {
  const before = Array.from({ length: 6 }, () => ({ visitors: 50, expected: 50 }));
  const after = Array.from({ length: 6 }, () => ({ visitors: 60, expected: 50 }));
  const r = computeNetInsightMeasurement({ before, after });
  assert.strictEqual(r.netDeltaPct, 20, `attendu 20, obtenu ${r.netDeltaPct}`);
});

check('effet net neutralise le confondeur (période après naturellement haute → 0)', () => {
  // Après = 2× plus de monde MAIS la baseline attendait déjà 2× plus (week-end,
  // beau temps…). L'action ne mérite AUCUN crédit → net 0, là où le brut aurait
  // faussement crédité +100 %.
  const before = Array.from({ length: 6 }, () => ({ visitors: 40, expected: 40 }));
  const after = Array.from({ length: 6 }, () => ({ visitors: 80, expected: 80 }));
  const r = computeNetInsightMeasurement({ before, after });
  assert.strictEqual(r.netDeltaPct, 0, `attendu 0 (pas d'effet réel), obtenu ${r.netDeltaPct}`);
});

check('échantillon insuffisant → net null', () => {
  const r = computeNetInsightMeasurement({ before: [{ visitors: 1, expected: 1 }], after: [{ visitors: 2, expected: 1 }] });
  assert.strictEqual(r.netDeltaPct, null);
});

check('expected <= 0 ignoré (pas de division par zéro)', () => {
  const before = Array.from({ length: 4 }, () => ({ visitors: 10, expected: 10 }));
  const after = [...Array.from({ length: 4 }, () => ({ visitors: 12, expected: 10 })), { visitors: 999, expected: 0 }];
  const r = computeNetInsightMeasurement({ before, after });
  assert.strictEqual(r.netDeltaPct, 20, `le jour expected:0 doit être retiré → +20, obtenu ${r.netDeltaPct}`);
});

// ── G2 : agrégation par contexte (trigger depuis la signature) ───────────────

check('agrégation patterns par contexte + moyenne + wins + tri', () => {
  const insights = [
    { signature: 'local_event:facebook', channel: 'facebook', payload: {}, result: { netDeltaPct: 22, deltaPct: 30 }, status: 'validated' },
    { signature: 'local_event:facebook', channel: 'facebook', payload: {}, result: { netDeltaPct: 18, deltaPct: 20 }, status: 'validated' },
    { signature: 'quiet_day:email', channel: 'email', payload: {}, result: { netDeltaPct: -5, deltaPct: -3 }, status: 'refuted' },
  ];
  const rows = buildPatternRows(insights);
  const evt = rows.find((r) => r.context_key === 'post|facebook|local_event');
  assert.ok(evt, 'contexte événement présent');
  assert.strictEqual(evt.avgNetDelta, 20, '(22+18)/2 = 20');
  assert.strictEqual(evt.n, 2);
  assert.strictEqual(evt.wins, 2);
  const quiet = rows.find((r) => r.context_key === 'email|email|quiet_day');
  assert.ok(quiet && quiet.avgNetDelta === -5);
  assert.strictEqual(rows[0].context_key, 'post|facebook|local_event', 'le meilleur contexte est trié en premier');
});

check('patterns : fallback sur le brut quand le net manque (anciennes mesures)', () => {
  const rows = buildPatternRows([{ signature: 'plan:1', channel: 'facebook', payload: {}, result: { deltaPct: 12 }, status: 'validated' }]);
  assert.strictEqual(rows[0].avgNetDelta, null);
  assert.strictEqual(rows[0].avgRawDelta, 12);
});

check('confiance selon le nombre d’observations', () => {
  const one = buildPatternRows([{ signature: 'a:facebook', channel: 'facebook', payload: {}, result: { netDeltaPct: 5 }, status: 'validated' }]);
  assert.strictEqual(one[0].confidence, 'exploratoire');
  const many = buildPatternRows(Array.from({ length: 6 }, () => ({ signature: 'a:facebook', channel: 'facebook', payload: {}, result: { netDeltaPct: 5 }, status: 'validated' })));
  assert.strictEqual(many[0].confidence, 'solide');
});

// ── G3 : réinjection déterministe ────────────────────────────────────────────

check('réinjection priorise le contexte prouvé positif', () => {
  const candidates = [
    { trigger: 'quiet_day', channel: 'email' },
    { trigger: 'local_event', channel: 'facebook' },
  ];
  const map = new Map([
    [patternContextKey({ kind: 'post', channel: 'facebook', trigger: 'local_event' }), { avgNetDelta: 22 }],
    [patternContextKey({ kind: 'email', channel: 'email', trigger: 'quiet_day' }), { avgNetDelta: -5 }],
  ]);
  const ranked = rankCandidatesByPatterns(candidates, map);
  assert.strictEqual(ranked[0].trigger, 'local_event', 'le contexte +22 passe premier');
  assert.ok(ranked[0].learnedPattern, 'pattern appris attaché au candidat');
});

check('réinjection : ordre stable quand aucun pattern connu', () => {
  const candidates = [{ trigger: 'rain_forecast', channel: 'facebook' }, { trigger: 'heat_forecast', channel: 'facebook' }];
  const ranked = rankCandidatesByPatterns(candidates, new Map());
  assert.strictEqual(ranked[0].trigger, 'rain_forecast');
  assert.strictEqual(ranked[1].trigger, 'heat_forecast');
});

check('cohérence clé de contexte candidat ↔ signature stockée', () => {
  // Un candidat rain_forecast/facebook doit produire la MÊME clé qu'un insight
  // dont la signature est 'rain_forecast:facebook' — sinon la boucle ne matche pas.
  const fromCandidate = patternContextKey({ kind: 'post', channel: 'facebook', trigger: 'rain_forecast' });
  const stored = buildPatternRows([{ signature: 'rain_forecast:facebook', channel: 'facebook', payload: {}, result: { netDeltaPct: 9 }, status: 'validated' }])[0].context_key;
  assert.strictEqual(fromCandidate, stored, `clé candidat ${fromCandidate} ≠ clé stockée ${stored}`);
});

console.log(`\nmarketing-patterns-check: ${passed} tests OK ✓`);
