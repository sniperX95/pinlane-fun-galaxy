// Budget guard LLM : garantit que la dépense API ne dépasse JAMAIS un plafond
// mensuel (par défaut 5 USD, override LLM_MONTHLY_BUDGET_USD). Au plafond, tous
// les appels LLM basculent en déterministe (le système continue de tourner sur
// SQL/heuristiques/templates). Non-fatal partout : rien ici ne casse un appel.
//
// Mesure = usage réel renvoyé par l'API (input/output/cache tokens). Ledger
// persisté (table llm_spend) + accumulateur en mémoire pour le chemin chaud
// (pas de lecture DB par appel).

// Prix Anthropic (USD par token). Haiku 4.5 : $1/M in, $5/M out. Cache lu ~10 %
// de l'input, écriture cache 5 min ~1.25x. Défaut Haiku si modèle inconnu.
const PRICES = {
  'claude-haiku-4-5': { input: 1 / 1e6, output: 5 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
  'claude-sonnet-4-5': { input: 3 / 1e6, output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
};

// PUR : coût USD d'un appel depuis l'objet usage de l'API Anthropic.
function computeCallCost(usage, model) {
  if (!usage) return 0;
  const price = PRICES[model] || PRICES['claude-haiku-4-5'];
  const inTok = Number(usage.input_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
  return inTok * price.input + outTok * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite;
}

// PUR : palier de dégradation (observabilité + décisions futures).
function budgetTier(spentUsd, budgetUsd) {
  const ratio = budgetUsd > 0 ? spentUsd / budgetUsd : 0;
  if (ratio >= 1) return 'exhausted';
  if (ratio >= 0.95) return 'minimal';
  if (ratio >= 0.8) return 'reduced';
  return 'normal';
}

function monthKey() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

function monthlyBudgetUsd() {
  const value = Number(process.env.LLM_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

let inMemory = null; // { month, cost }
let seeding = false;

function ensureMonth() {
  const month = monthKey();
  if (!inMemory || inMemory.month !== month) inMemory = { month, cost: 0 };
  return inMemory;
}

// Amorce l'accumulateur depuis la DB une fois (best-effort, non bloquant). Le
// chemin chaud n'attend jamais ceci : il lit l'accumulateur courant.
function seedFromDb() {
  if (seeding) return;
  seeding = true;
  Promise.resolve()
    .then(async () => {
      const { getPool } = require('./database');
      const month = monthKey();
      const result = await getPool().query('select cost_usd from llm_spend where month = $1;', [month]);
      if (result.rows[0]) {
        const current = ensureMonth();
        current.cost = Math.max(current.cost, Number(result.rows[0].cost_usd) || 0);
      }
    })
    .catch(() => { /* non-fatal : sans DB, on reste sur l'accumulateur mémoire */ });
}

function getMonthlySpend() {
  seedFromDb();
  return ensureMonth().cost;
}

function isBudgetExhausted() {
  return getMonthlySpend() >= monthlyBudgetUsd();
}

// Enregistre le coût d'un appel : accumulateur immédiat + upsert DB best-effort.
function recordSpend(costUsd) {
  const cost = Number(costUsd) || 0;
  if (cost <= 0) return;
  const current = ensureMonth();
  current.cost += cost;
  try {
    const { getPool } = require('./database');
    getPool()
      .query(
        `insert into llm_spend (month, cost_usd, calls) values ($1, $2, 1)
         on conflict (month) do update set cost_usd = llm_spend.cost_usd + $2, calls = llm_spend.calls + 1, updated_at = now();`,
        [current.month, cost],
      )
      .catch(() => {});
  } catch (error) { /* non-fatal */ }
}

function budgetStatus() {
  const spent = getMonthlySpend();
  const budget = monthlyBudgetUsd();
  return { month: monthKey(), spentUsd: Math.round(spent * 10000) / 10000, budgetUsd: budget, tier: budgetTier(spent, budget), exhausted: spent >= budget };
}

// Testable : réinitialise l'accumulateur mémoire (pour les tests uniquement).
function __resetForTests() {
  inMemory = null;
  seeding = false;
}

module.exports = {
  computeCallCost,
  budgetTier,
  monthlyBudgetUsd,
  getMonthlySpend,
  isBudgetExhausted,
  recordSpend,
  budgetStatus,
  __resetForTests,
};
