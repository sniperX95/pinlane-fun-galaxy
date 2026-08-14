// Budget guard LLM : garantit que la dépense API ne dépasse JAMAIS un plafond
// mensuel (par défaut 5 USD, override LLM_MONTHLY_BUDGET_USD). Au plafond, tous
// les appels LLM basculent en déterministe (le système continue de tourner sur
// SQL/heuristiques/templates). Non-fatal partout : rien ici ne casse un appel.
//
// Mesure = usage réel renvoyé par l'API (input/output/cache tokens). Ledger
// persisté (table llm_spend) + accumulateur en mémoire pour le chemin chaud
// (pas de lecture DB par appel).

// Prix (USD par token). Anthropic : Haiku 4.5 $1/M in, $5/M out, cache lu
// ~10 % de l'input, écriture cache 5 min ~1.25x. OpenAI (chemin de secours) :
// gpt-4.1-mini $0.40/M in, $1.60/M out, input caché $0.10/M ; gpt-4.1 $2/$8.
const PRICES = {
  'claude-haiku-4-5': { input: 1 / 1e6, output: 5 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
  'claude-sonnet-4-5': { input: 3 / 1e6, output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
  'gpt-4.1-mini': { input: 0.4 / 1e6, output: 1.6 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 0 },
  'gpt-4.1': { input: 2 / 1e6, output: 8 / 1e6, cacheRead: 0.5 / 1e6, cacheWrite: 0 },
  // Kimi (Moonshot), tarifs internationaux releves le 2026-08-14 sur
  // platform.kimi.ai. Le cache y est facture 80 a 90 % sous le tarif d'entree.
  // K3 est le vaisseau amiral (raisonnement long, code) et coute 3 a 4 fois le
  // prix de K2.6 : la redaction marketing courte et groundee de Pinlane n'en a
  // pas l'usage, d'ou le defaut sur K2.6.
  'kimi-k3': { input: 3 / 1e6, output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 0 },
  'kimi-k2.7-code': { input: 0.95 / 1e6, output: 4 / 1e6, cacheRead: 0.19 / 1e6, cacheWrite: 0 },
  'kimi-k2.6': { input: 0.95 / 1e6, output: 4 / 1e6, cacheRead: 0.16 / 1e6, cacheWrite: 0 },
  'kimi-k2.5': { input: 0.6 / 1e6, output: 3 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 0 },
};

// Modèle inconnu → tarif le plus CHER de la table, composant par composant.
// L'ancien repli (tarif Haiku, le moins cher) trouait le plafond : un modèle
// non listé était sous-facturé. Sur-facturer FERME le budget, jamais l'inverse.
const MOST_EXPENSIVE_PRICE = Object.values(PRICES).reduce((max, price) => ({
  input: Math.max(max.input, price.input),
  output: Math.max(max.output, price.output),
  cacheRead: Math.max(max.cacheRead, price.cacheRead),
  cacheWrite: Math.max(max.cacheWrite, price.cacheWrite),
}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// PUR : coût USD d'un appel depuis l'objet usage de l'API Anthropic.
function computeCallCost(usage, model) {
  if (!usage) return 0;
  const price = PRICES[model] || MOST_EXPENSIVE_PRICE;
  const inTok = Number(usage.input_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
  return inTok * price.input + outTok * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite;
}

// PUR : coût USD depuis l'objet usage de l'API OpenAI (Responses). Chez
// OpenAI, input_tokens INCLUT les tokens caches (input_tokens_details
// .cached_tokens) : on les separe pour facturer chaque part a son tarif.
// OpenRouter facture au modele choisi. Les modeles « :free » sont a zero,
// mais on les compte quand meme : un plafond ne protege que s'il voit tous les
// appels, et un modele gratuit peut cesser de l'etre du jour au lendemain.
// Tout modele inconnu retombe sur le tarif le plus cher connu : se tromper en
// surestimant coupe trop tot, se tromper en sous-estimant depasse le plafond.
function computeOpenRouterCallCost(usage, model) {
  if (!usage) return 0;
  if (String(model || '').endsWith(':free')) return 0;
  const price = PRICES[model] || MOST_EXPENSIVE_PRICE;
  const input = Number(usage.prompt_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  return input * price.input + output * price.output;
}

// PUR : cout USD depuis l'objet usage de Kimi (dialecte OpenAI chat/completions).
// `prompt_tokens` INCLUT les tokens lus en cache (`cached_tokens`), comme chez
// OpenAI : on separe les deux parts pour facturer chacune a son tarif, sinon le
// cache serait facture plein pot et le plafond se fermerait trop tot.
function computeKimiCallCost(usage, model) {
  if (!usage) return 0;
  const price = PRICES[model] || MOST_EXPENSIVE_PRICE;
  const inTok = Number(usage.prompt_tokens) || 0;
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens) || 0;
  const outTok = Number(usage.completion_tokens) || 0;
  const freshIn = Math.max(0, inTok - cached);
  return freshIn * price.input + cached * price.cacheRead + outTok * price.output;
}

function computeOpenAiCallCost(usage, model) {
  if (!usage) return 0;
  const price = PRICES[model] || MOST_EXPENSIVE_PRICE;
  const inTok = Number(usage.input_tokens) || 0;
  const cached = Number(usage.input_tokens_details?.cached_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  const freshIn = Math.max(0, inTok - cached);
  return freshIn * price.input + cached * price.cacheRead + outTok * price.output;
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
  computeOpenRouterCallCost,
  computeCallCost,
  computeOpenAiCallCost,
  computeKimiCallCost,
  budgetTier,
  monthlyBudgetUsd,
  getMonthlySpend,
  isBudgetExhausted,
  recordSpend,
  budgetStatus,
  __resetForTests,
};
