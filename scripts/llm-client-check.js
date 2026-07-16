// Gate du client LLM unifié (lib/llm-client.js) : zéro réseau, fetch mocké.
// Couvre : priorité Anthropic > OpenAI > null, payload Anthropic conforme
// (headers, modèle Haiku par défaut, cache_control sur le bloc stable,
// output_config json_schema, max_tokens), extraction/refus/troncature/erreurs,
// payload OpenAI inchangé (Responses API, json_schema strict, openaiModel).
const { llmProvider, anthropicModel, callLlm, callLlmJson } = require('../lib/llm-client');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_MARKETING_MODEL', 'OPENAI_MARKETING_MODEL'];
const saved = {};
for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
function restoreEnv() { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }

// fetch mocké : enregistre l'appel, rend la réponse programmée.
function makeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return respond(call);
  };
  return { calls, impl };
}
const anthropicOk = (text, stopReason = 'end_turn') => ({
  ok: true,
  json: async () => ({ stop_reason: stopReason, content: [{ type: 'text', text }] }),
});

(async () => {
  console.log('[PROVIDER] résolution par clés');
  ok(llmProvider() === null, 'aucune clé → provider null');
  const noKey = await callLlm({ stableSystem: 's', user: 'u', fetchImpl: () => { throw new Error('ne doit pas être appelé'); } });
  ok(noKey === null, 'aucune clé → callLlm null sans appel réseau');
  process.env.OPENAI_API_KEY = 'test-key-openai';
  ok(llmProvider() === 'openai', 'OpenAI seule → openai');
  process.env.ANTHROPIC_API_KEY = 'test-key-anthropic';
  ok(llmProvider() === 'anthropic', 'les deux clés → Anthropic PRIORITAIRE');
  delete process.env.OPENAI_API_KEY;
  ok(anthropicModel() === 'claude-haiku-4-5', 'modèle par défaut : claude-haiku-4-5 (coût mini)');
  process.env.ANTHROPIC_MARKETING_MODEL = 'claude-sonnet-4-5';
  ok(anthropicModel() === 'claude-sonnet-4-5', 'ANTHROPIC_MARKETING_MODEL override honoré');
  delete process.env.ANTHROPIC_MARKETING_MODEL;

  console.log('\n[ANTHROPIC] payload Messages API conforme');
  const fx1 = makeFetch(() => anthropicOk('{"content":"Réécrit."}'));
  const schema = { type: 'object', additionalProperties: false, properties: { content: { type: 'string' } }, required: ['content'] };
  const r1 = await callLlmJson({
    stableSystem: 'PLAYBOOK STABLE', system: 'contexte du jour', user: '{"fait":1}',
    schema, schemaName: 'polished', maxTokens: 400, fetchImpl: fx1.impl,
  });
  const call1 = fx1.calls[0];
  ok(call1 && call1.url === 'https://api.anthropic.com/v1/messages', 'URL /v1/messages');
  ok(call1.init.headers['x-api-key'] === 'test-key-anthropic' && call1.init.headers['anthropic-version'] === '2023-06-01', 'headers x-api-key + anthropic-version');
  ok(call1.body.model === 'claude-haiku-4-5' && call1.body.max_tokens === 400, `model + max_tokens serrés (${call1.body.model}, ${call1.body.max_tokens})`);
  ok(Array.isArray(call1.body.system) && call1.body.system[0].text === 'PLAYBOOK STABLE'
    && call1.body.system[0].cache_control && call1.body.system[0].cache_control.type === 'ephemeral', 'bloc stable en 1er avec cache_control ephemeral (prompt caching)');
  ok(call1.body.system[1] && call1.body.system[1].text === 'contexte du jour' && !call1.body.system[1].cache_control, 'bloc volatile APRÈS le breakpoint, sans cache_control');
  ok(call1.body.output_config && call1.body.output_config.format.type === 'json_schema'
    && JSON.stringify(call1.body.output_config.format.schema) === JSON.stringify(schema), 'sortie JSON forcée via output_config.format');
  ok(call1.body.messages.length === 1 && call1.body.messages[0].role === 'user', 'message user unique');
  ok(r1 && r1.content === 'Réécrit.' && r1._provider === 'anthropic' && r1._model === 'claude-haiku-4-5', 'JSON parsé + _provider/_model');

  console.log('\n[ANTHROPIC] robustesse');
  const fxRefusal = makeFetch(() => anthropicOk('{"content":"x"}', 'refusal'));
  ok((await callLlmJson({ user: 'u', schema, fetchImpl: fxRefusal.impl })) === null, 'stop_reason refusal → null (fallback règles)');
  const fxTrunc = makeFetch(() => anthropicOk('{"content":"cou', 'max_tokens'));
  ok((await callLlmJson({ user: 'u', schema, fetchImpl: fxTrunc.impl })) === null, 'stop_reason max_tokens (tronqué) → null');
  const fx500 = makeFetch(() => ({ ok: false, json: async () => ({}) }));
  ok((await callLlm({ user: 'u', fetchImpl: fx500.impl })) === null, 'HTTP non-ok → null');
  const fxThrow = makeFetch(() => { throw new Error('réseau'); });
  ok((await callLlm({ user: 'u', fetchImpl: fxThrow.impl })) === null, 'fetch qui throw (timeout/réseau) → null');
  const fxBadJson = makeFetch(() => anthropicOk('pas du json'));
  ok((await callLlmJson({ user: 'u', schema, fetchImpl: fxBadJson.impl })) === null, 'texte non-JSON avec schema → null');
  ok((await callLlm({ fetchImpl: fx1.impl })) === null, 'user manquant → null');
  const fxText = makeFetch(() => anthropicOk('# Bilan direction'));
  const rText = await callLlm({ stableSystem: 's', user: 'markdown source', fetchImpl: fxText.impl });
  ok(rText && rText.text === '# Bilan direction' && !fxText.calls[0].body.output_config, 'mode texte libre : pas d\'output_config, texte brut rendu');

  console.log('\n[OPENAI] chemin conservé à l\'identique');
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-openai';
  const fxO = makeFetch(() => ({ ok: true, json: async () => ({ output_text: '{"subject":"Objet","body":"Corps"}' }) }));
  const emailSchema = { type: 'object', additionalProperties: false, properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] };
  const rO = await callLlmJson({
    stableSystem: 'REGLES', system: 'volatile', user: '{"a":1}',
    schema: emailSchema, schemaName: 'improved_email', openaiModel: 'gpt-4o-mini', fetchImpl: fxO.impl,
  });
  const callO = fxO.calls[0];
  ok(callO.url === 'https://api.openai.com/v1/responses', 'URL Responses API');
  ok(callO.init.headers.Authorization === 'Bearer test-key-openai', 'header Authorization Bearer');
  ok(callO.body.model === 'gpt-4o-mini', 'openaiModel par appel honoré');
  ok(callO.body.input[0].role === 'system' && callO.body.input[0].content.includes('REGLES') && callO.body.input[0].content.includes('volatile'), 'system = stable + volatile concaténés');
  ok(callO.body.text.format.type === 'json_schema' && callO.body.text.format.strict === true && callO.body.text.format.name === 'improved_email', 'json_schema strict + name (format OpenAI)');
  ok(rO && rO.subject === 'Objet' && rO._provider === 'openai', 'réponse OpenAI parsée + _provider');

  console.log('\n[SITES] câblage des consommateurs');
  delete process.env.OPENAI_API_KEY;
  const emailStudio = require('../lib/email-studio');
  const det = await emailStudio.improveEmailDraft({ subject: 'Test', body: 'Corps court' });
  ok(det.mode === 'deterministe' && Array.isArray(det.tips) && det.tips.length > 0, 'email-studio sans clé → déterministe avec tips');
  const cm = require('../lib/center-metrics');
  ok(typeof cm.polishIdeaWithAi === 'function', 'center-metrics exporte polishIdeaWithAi (renommage propre)');
  const pol = await cm.polishIdeaWithAi({ readyContent: 'x', dataBasis: [], why: '' }, { fetchImpl: () => { throw new Error('no'); } });
  ok(pol === null, 'polishIdeaWithAi sans clé → null (fallback template)');

  restoreEnv();
  if (failures) { console.error(`\nllm-client-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nllm-client-check: ALL OK');
})().catch((error) => { restoreEnv(); console.error('llm-client-check CRASH:', error.stack || error.message); process.exit(1); });
