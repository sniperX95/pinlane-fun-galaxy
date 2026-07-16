// Budget guard LLM : tests PURS (sans DB, sans réseau). Prouve le calcul de
// coût réel et le plafond dur (au-delà → déterministe).
const assert = require('assert');
const budget = require('../lib/llm-budget');

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ok ', name); }

check('coût Haiku exact (1000 in + 200 out = 0.002 $)', () => {
  const cost = budget.computeCallCost({ input_tokens: 1000, output_tokens: 200 }, 'claude-haiku-4-5');
  assert.ok(Math.abs(cost - 0.002) < 1e-9, `attendu 0.002, obtenu ${cost}`);
});

check('cache lu facturé ~10 % de l’input', () => {
  const cost = budget.computeCallCost({ cache_read_input_tokens: 1000 }, 'claude-haiku-4-5');
  assert.ok(Math.abs(cost - 0.0001) < 1e-9, `attendu 0.0001, obtenu ${cost}`);
});

check('écriture cache facturée ~1.25x input', () => {
  const cost = budget.computeCallCost({ cache_creation_input_tokens: 1000 }, 'claude-haiku-4-5');
  assert.ok(Math.abs(cost - 0.00125) < 1e-9, `attendu 0.00125, obtenu ${cost}`);
});

check('usage absent → 0 (jamais de NaN)', () => {
  assert.strictEqual(budget.computeCallCost(null, 'claude-haiku-4-5'), 0);
  assert.strictEqual(budget.computeCallCost({}, 'modele-inconnu'), 0);
  assert.strictEqual(budget.computeOpenAiCallCost(null, 'gpt-4.1-mini'), 0);
});

check('coût OpenAI exact (cached_tokens séparés du plein tarif)', () => {
  // gpt-4.1-mini : 1000 in dont 200 cachés + 500 out
  // = 800×0.40/M + 200×0.10/M + 500×1.60/M = 0.00114 $
  const cost = budget.computeOpenAiCallCost(
    { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 500 },
    'gpt-4.1-mini',
  );
  assert.ok(Math.abs(cost - 0.00114) < 1e-9, `attendu 0.00114, obtenu ${cost}`);
});

check('modèle inconnu → tarif le plus CHER (défaut E : sous-facturer troue le plafond)', () => {
  const unknownIn = budget.computeCallCost({ input_tokens: 1e6 }, 'modele-mystere');
  const unknownOut = budget.computeCallCost({ output_tokens: 1e6 }, 'modele-mystere');
  const knownRates = [
    ['claude-haiku-4-5', 1, 5], ['claude-sonnet-4-5', 3, 15], ['gpt-4.1-mini', 0.4, 1.6], ['gpt-4.1', 2, 8],
  ];
  for (const [model, inRate, outRate] of knownRates) {
    assert.ok(unknownIn >= inRate, `inconnu (${unknownIn}) >= input de ${model}`);
    assert.ok(unknownOut >= outRate, `inconnu (${unknownOut}) >= output de ${model}`);
  }
  const unknownOpenAi = budget.computeOpenAiCallCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'autre-mystere');
  assert.ok(unknownOpenAi >= unknownIn, 'le repli OpenAI est aussi au plus cher');
});

check('paliers de dégradation', () => {
  assert.strictEqual(budget.budgetTier(0, 5), 'normal');
  assert.strictEqual(budget.budgetTier(4.1, 5), 'reduced');
  assert.strictEqual(budget.budgetTier(4.8, 5), 'minimal');
  assert.strictEqual(budget.budgetTier(5, 5), 'exhausted');
  assert.strictEqual(budget.budgetTier(6, 5), 'exhausted');
});

check('plafond dur : accumulation → exhausted', () => {
  budget.__resetForTests();
  process.env.LLM_MONTHLY_BUDGET_USD = '0.01';
  assert.strictEqual(budget.isBudgetExhausted(), false, 'à zéro, pas épuisé');
  budget.recordSpend(0.005);
  assert.strictEqual(budget.isBudgetExhausted(), false, 'sous le plafond');
  budget.recordSpend(0.02);
  assert.ok(budget.getMonthlySpend() >= 0.025, 'dépense accumulée');
  assert.strictEqual(budget.isBudgetExhausted(), true, 'au-dessus du plafond → épuisé');
  const status = budget.budgetStatus();
  assert.strictEqual(status.exhausted, true);
  assert.strictEqual(status.tier, 'exhausted');
  delete process.env.LLM_MONTHLY_BUDGET_USD;
  budget.__resetForTests();
});

check('budget par défaut = 5 $ quand non configuré', () => {
  delete process.env.LLM_MONTHLY_BUDGET_USD;
  assert.strictEqual(budget.monthlyBudgetUsd(), 5);
  process.env.LLM_MONTHLY_BUDGET_USD = '12.5';
  assert.strictEqual(budget.monthlyBudgetUsd(), 12.5);
  delete process.env.LLM_MONTHLY_BUDGET_USD;
});

console.log(`\nllm-budget-check: ${passed} tests OK ✓`);
