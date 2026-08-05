// Client LLM unifié Pinlane : Anthropic (Claude) d'abord, OpenAI ensuite.
// Les appelants gardent toujours leur chemin déterministe : ce module ne throw
// jamais (retour null sur toute erreur) et ne logge jamais une clé ni un corps
// de réponse brut.
//
// Coût maîtrisé :
// - Claude Haiku 4.5 par défaut ($1/M tokens entrée, $5/M sortie), la
//   rédaction courte groundée n'a pas besoin de plus. Override via
//   ANTHROPIC_MARKETING_MODEL (ex. claude-sonnet-4-5 si un jour la qualité
//   d'un canal l'exige).
// - max_tokens serré par usage (posts ~1000, polish ~400, rapport ~2000).
// - Prompt caching : le bloc système stable (playbook/voix) porte
//   cache_control ephemeral : les appels groupés d'un même cycle relisent le
//   cache à ~10 % du prix ; sous le minimum cacheable c'est un no-op silencieux.

const { computeCallCost, computeOpenAiCallCost, computeOpenRouterCallCost, recordSpend, isBudgetExhausted } = require('./llm-budget');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/responses';
// OpenRouter parle le dialecte « chat/completions », PAS l'API Responses
// d'OpenAI : c'est un troisieme chemin, pas une URL de base a echanger.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5';
const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';
// Modele par defaut choisi par ESSAI, pas au catalogue : sur les quatorze
// gratuits, le 31b etait limite en debit en amont (429), nemotron monologue
// au lieu de repondre (« User says: ... ») et ling ne repondait pas. Celui-ci
// rend une phrase propre. Surchargeable par OPENROUTER_MODEL.
const OPENROUTER_DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

// ── LA FRONTIERE DES DONNEES ────────────────────────────────────────────────
// Un compte OpenRouter sans credits n'ouvre que les modeles « :free », et pour
// ceux-la les fournisseurs peuvent exploiter les requetes. Or le site promet
// « vos donnees restent les votres » et la FAQ « aucune revente, aucun
// partage » : l'agent qui lit les COURRIELS des clients (expediteur, objet,
// corps, fiche client) ne doit donc jamais passer par la.
// D'ou un appel TYPE : seul ce qui ne contient aucune donnee personnelle —
// la redaction marketing, les idees de publication — peut sortir vers
// OpenRouter. Le reste garde le fournisseur contractuel.
// `sensitive: true` est le DEFAUT : un nouvel appelant qui oublie de se
// declarer est protege, pas expose.
const OPENROUTER_ALLOWED = new Set(['marketing', 'content', 'competitor']);

function openrouterModel() {
  return process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
}

// Provider actif pour CET appel. `usage` decide si OpenRouter est ouvert ;
// entre fournisseurs contractuels, Anthropic reste prioritaire.
function llmProvider(usage) {
  const force = String(process.env.LLM_PROVIDER || '').toLowerCase();
  const openrouterOk = Boolean(process.env.OPENROUTER_API_KEY) && OPENROUTER_ALLOWED.has(usage);
  if (force === 'openrouter' && openrouterOk) return 'openrouter';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (openrouterOk) return 'openrouter';
  return null;
}

function anthropicModel() {
  return process.env.ANTHROPIC_MARKETING_MODEL || ANTHROPIC_DEFAULT_MODEL;
}

// ── Mesure du cache de prompt (defaut D de l'audit) ─────────────────────────
// Le commentaire de tete documentait deja le no-op silencieux sous le minimum
// cacheable, mais rien ne le MESURAIT : personne ne savait que le cache
// dormait (bloc stable reel ~2 200-2 600 tokens, minimum Haiku 4.5 = 4 096).
// Ici : estimation ~4 chars/token, et UN log JSON par processus quand le bloc
// est sous le seuil. Observabilite, pas de changement de comportement.
const CACHE_MIN_TOKENS_BY_MODEL = {
  'claude-haiku-4-5': 4096,
  'claude-sonnet-4-5': 1024,
};
const CACHE_MIN_TOKENS_DEFAULT = 4096;

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function cacheableMinTokens(model) {
  return CACHE_MIN_TOKENS_BY_MODEL[model] || CACHE_MIN_TOKENS_DEFAULT;
}

let cacheNoopLogged = false;
function logCacheNoopOnce(stableSystem, model) {
  if (cacheNoopLogged || !stableSystem) return;
  const estimated = estimateTokens(stableSystem);
  const minimum = cacheableMinTokens(model);
  if (estimated >= minimum) return;
  cacheNoopLogged = true;
  console.log(JSON.stringify({
    level: 'info',
    module: 'llm-client',
    message: 'prompt_cache_inactive',
    detail: 'bloc stable sous le minimum cacheable : cache_control est un no-op, plein tarif',
    estimatedTokens: estimated,
    minCacheableTokens: minimum,
    model,
  }));
}

async function callAnthropic({ stableSystem, system, user, schema, maxTokens, timeoutMs, fetchImpl }) {
  const model = anthropicModel();
  logCacheNoopOnce(stableSystem, model);
  const systemBlocks = [];
  if (stableSystem) {
    systemBlocks.push({ type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } });
  }
  if (system) systemBlocks.push({ type: 'text', text: system });
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: user }],
  };
  if (systemBlocks.length) body.system = systemBlocks;
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    // Budget guard : on enregistre le coût RÉEL (tokens facturés même sur un
    // refus). Non-fatal.
    recordSpend(computeCallCost(payload?.usage, model));
    // Refus classifieur ou sortie tronquée par max_tokens : on laisse le
    // fallback déterministe reprendre la main plutôt que publier un texte
    // incomplet.
    if (payload?.stop_reason && payload.stop_reason !== 'end_turn') return null;
    const text = (Array.isArray(payload?.content) ? payload.content : [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text || '')
      .join('')
      .trim();
    if (!text) return null;
    return { text, provider: 'anthropic', model };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text) return part.text;
    }
  }
  return '';
}

async function callOpenAi({ stableSystem, system, user, schema, schemaName, timeoutMs, fetchImpl, openaiModel }) {
  const model = openaiModel || process.env.OPENAI_MARKETING_MODEL || OPENAI_DEFAULT_MODEL;
  const body = {
    model,
    input: [
      { role: 'system', content: [stableSystem, system].filter(Boolean).join('\n\n') },
      { role: 'user', content: user },
    ],
  };
  if (schema) {
    body.text = { format: { type: 'json_schema', name: schemaName, strict: true, schema } };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    // Budget guard : le chemin OpenAI debite comme le chemin Anthropic (defaut
    // E de l'audit : sans cette ligne, le plafond de 5 USD etait une passoire
    // des que OPENAI_API_KEY existait). Cout REEL, meme si le texte est vide.
    recordSpend(computeOpenAiCallCost(payload?.usage, model));
    const text = extractOpenAiText(payload).trim();
    if (!text) return null;
    return { text, provider: 'openai', model };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Appel texte : { text, provider, model } ou null.
// - stableSystem : bloc système STABLE (playbook, voix de marque), identique
//   d'un appel à l'autre pour que le cache Anthropic prenne. Le contenu
//   volatile (faits du jour, brief) va dans `system` ou `user`.
// - schema : JSON Schema strict (additionalProperties:false + required) →
//   sortie JSON forcée chez les deux providers.
async function callLlm({
  stableSystem = '',
  system = '',
  user,
  schema = null,
  schemaName = 'output',
  maxTokens = 1000,
  timeoutMs = 14000,
  fetchImpl = fetch,
  openaiModel = null,
  // Nature de l'appel. Voir OPENROUTER_ALLOWED : seuls les usages sans donnee
  // personnelle peuvent sortir vers un modele gratuit. Ne rien declarer =
  // traite comme sensible.
  usage = 'sensitive',
} = {}) {
  if (!user) return null;
  // Plafond mensuel atteint → on ne dépense plus : bascule déterministe (le
  // fallback template reprend partout). Garantit que les €5 ne sont jamais dépassés.
  if (isBudgetExhausted()) return null;
  const provider = llmProvider(usage);
  if (provider === 'anthropic') {
    return callAnthropic({ stableSystem, system, user, schema, maxTokens, timeoutMs, fetchImpl });
  }
  if (provider === 'openai') {
    return callOpenAi({ stableSystem, system, user, schema, schemaName, timeoutMs, fetchImpl, openaiModel });
  }
  if (provider === 'openrouter') {
    return callOpenRouter({ stableSystem, system, user, schema, maxTokens, timeoutMs, fetchImpl });
  }
  return null;
}

// OpenRouter : dialecte chat/completions. Les deux en-tetes d'attribution sont
// ceux que le service demande pour rattacher le trafic a une application.
async function callOpenRouter({ stableSystem, system, user, schema, maxTokens, timeoutMs, fetchImpl }) {
  const model = openrouterModel();
  const messages = [];
  const sys = [stableSystem, system].filter(Boolean).join('\n\n');
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: user });
  const body = { model, messages, max_tokens: maxTokens };
  // Les modeles ouverts suivent mal une consigne « reponds en JSON » : on
  // demande le mode JSON quand un schema est attendu.
  if (schema) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pinlane.be',
        'X-Title': 'Pinlane',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '')
      : '';
    if (!text) return null;
    // Le cout reste compte, meme a zero : un plafond ne protege que s'il voit
    // TOUS les appels, et un modele gratuit peut cesser de l'etre.
    const usage = (data && data.usage) || {};
    recordSpend(computeOpenRouterCallCost(usage, model));
    return { text, provider: 'openrouter', model };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Appel JSON : objet parsé (+ _provider/_model) ou null.
async function callLlmJson(options) {
  const result = await callLlm(options);
  if (!result) return null;
  try {
    const parsed = JSON.parse(result.text);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, _provider: result.provider, _model: result.model };
  } catch (error) {
    return null;
  }
}

module.exports = {
  llmProvider, anthropicModel, openrouterModel, callLlm, callLlmJson,
  estimateTokens, cacheableMinTokens, OPENROUTER_ALLOWED,
};
