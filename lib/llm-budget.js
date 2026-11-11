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
  // Le chef de garde (2026-11-06) : Sonnet 5.5, $2/M en entree, $10/M en sortie.
  'claude-sonnet-5-5': { input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 2.5 / 1e6 },
  // L agent des mails (2026-11-07) : Haiku 5.5, $0.10/M en entree, $0.50/M en
  // sortie (prompts sous 100 000 tokens). Cache aux memes ratios que les autres.
  'claude-haiku-5-5': { input: 0.1 / 1e6, output: 0.5 / 1e6, cacheRead: 0.01 / 1e6, cacheWrite: 0.125 / 1e6 },
  // L assistant, pour les decisions qui comptent (2026-11-11) : Opus 5.5, $4/M en entree, $20/M en
  // sortie, cache lu a 0,05x ($0.20/M, guide de l API), ecrit a 1,25x.
  'claude-opus-5-5': { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 5 / 1e6 },
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

// LA CAISSE DU CHEF DE GARDE (2026-11-06). Le bilan du matin et l explication d une
// panne ne partagent pas le plafond des agents marketing : en octobre ceux-ci l ont
// atteint le 20, et le bilan serait reparti en texte de regles pour dix jours. La garde
// a sa ligne a part dans llm_spend (« 2026-11:garde »), 2 USD par mois par defaut
// (LLM_GARDE_BUDGET_USD), pour une depense attendue sous 0,50 USD.
// LA CAISSE DES MAILS (2026-11-07, choix d Ansar : 5 USD par mois, a part du
// marketing). Pour la meme raison : quand les agents marketing vidaient la caisse
// commune, chaque mail de client retombait sur une reponse type vide jusqu a la
// fin du mois. Ligne « 2026-11:mails » dans llm_spend, plafond LLM_MAILS_BUDGET_USD.
// « assistant » : la conversation Marketing du gerant, plafond LLM_ASSISTANT_BUDGET_USD. Elle a son
// poste pour qu une semaine de grosses questions ne coupe jamais les mails ni la garde.
const POSTES = new Set(['commun', 'garde', 'mails', 'assistant']);
const posteDe = (poste) => (POSTES.has(poste) ? poste : 'commun');
const PLAFONDS = {
  commun: ['LLM_MONTHLY_BUDGET_USD', 5],
  garde: ['LLM_GARDE_BUDGET_USD', 2],
  mails: ['LLM_MAILS_BUDGET_USD', 5],
  assistant: ['LLM_ASSISTANT_BUDGET_USD', 20],
};

function monthKey(poste = 'commun') {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const p = posteDe(poste);
  return p === 'commun' ? month : `${month}:${p}`;
}

function monthlyBudgetUsd(poste = 'commun') {
  const [variable, defaut] = PLAFONDS[posteDe(poste)];
  const value = Number(process.env[variable]);
  return Number.isFinite(value) && value > 0 ? value : defaut;
}

const inMemory = new Map(); // poste -> { month, cost }
const seeding = new Set();

function ensureMonth(poste = 'commun') {
  const p = posteDe(poste);
  const month = monthKey(p);
  const courant = inMemory.get(p);
  if (!courant || courant.month !== month) inMemory.set(p, { month, cost: 0 });
  return inMemory.get(p);
}

// Amorce l'accumulateur depuis la DB une fois (best-effort, non bloquant). Le
// chemin chaud n'attend jamais ceci : il lit l'accumulateur courant.
function seedFromDb(poste = 'commun') {
  const p = posteDe(poste);
  if (seeding.has(p)) return;
  seeding.add(p);
  Promise.resolve()
    .then(async () => {
      const { getPool } = require('./database');
      const month = monthKey(p);
      const result = await getPool().query('select cost_usd from llm_spend where month = $1;', [month]);
      if (result.rows[0]) {
        const current = ensureMonth(p);
        current.cost = Math.max(current.cost, Number(result.rows[0].cost_usd) || 0);
      }
    })
    .catch(() => { /* non-fatal : sans DB, on reste sur l'accumulateur mémoire */ });
}

function getMonthlySpend(poste = 'commun') {
  seedFromDb(poste);
  return ensureMonth(poste).cost;
}

function isBudgetExhausted(poste = 'commun') {
  return getMonthlySpend(poste) >= monthlyBudgetUsd(poste);
}

// Enregistre le coût d'un appel : accumulateur immédiat + upsert DB best-effort.
function recordSpend(costUsd, poste = 'commun') {
  const cost = Number(costUsd) || 0;
  if (cost <= 0) return;
  const current = ensureMonth(poste);
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

function budgetStatus(poste = 'commun') {
  const spent = getMonthlySpend(poste);
  const budget = monthlyBudgetUsd(poste);
  return { month: monthKey(poste), spentUsd: Math.round(spent * 10000) / 10000, budgetUsd: budget, tier: budgetTier(spent, budget), exhausted: spent >= budget };
}

// Testable : réinitialise l'accumulateur mémoire (pour les tests uniquement).
function __resetForTests() {
  inMemory.clear();
  seeding.clear();
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
