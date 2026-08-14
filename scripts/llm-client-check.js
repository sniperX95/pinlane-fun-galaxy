// Gate du client LLM unifié (lib/llm-client.js) : zéro réseau, fetch mocké.
// Couvre : priorité Anthropic > OpenAI > null, payload Anthropic conforme
// (headers, modèle Haiku par défaut, cache_control sur le bloc stable,
// output_config json_schema, max_tokens), extraction/refus/troncature/erreurs,
// payload OpenAI inchangé (Responses API, json_schema strict, openaiModel).
const { llmProvider, anthropicModel, callLlm, callLlmJson, estimateTokens, cacheableMinTokens } = require('../lib/llm-client');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_MARKETING_MODEL', 'OPENAI_MARKETING_MODEL',
  'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_MODEL', 'LLM_PROVIDER', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];
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
  const fxO = makeFetch(() => ({ ok: true, json: async () => ({ output_text: '{"subject":"Objet","body":"Corps"}', usage: { input_tokens: 1000, output_tokens: 500 } }) }));
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

  console.log('\n[BUDGET] le chemin OpenAI débite le budget (défaut E)');
  const llmBudget = require('../lib/llm-budget');
  llmBudget.__resetForTests();
  const before = llmBudget.getMonthlySpend();
  const fxSpend = makeFetch(() => ({ ok: true, json: async () => ({ output_text: 'texte', usage: { input_tokens: 100000, output_tokens: 50000 } }) }));
  const rSpend = await callLlm({ user: 'u', openaiModel: 'gpt-4.1-mini', fetchImpl: fxSpend.impl });
  ok(rSpend && rSpend.provider === 'openai', 'appel OpenAI mocké passé');
  const spent = llmBudget.getMonthlySpend() - before;
  // 100k in × 0.40/M + 50k out × 1.60/M = 0.04 + 0.08 = 0.12 $
  ok(Math.abs(spent - 0.12) < 1e-9, `dépense enregistrée exacte sur le chemin OpenAI (attendu 0.12, obtenu ${spent})`);
  llmBudget.__resetForTests();

  console.log('\n[CACHE] la taille du bloc stable est MESURÉE contre le seuil cacheable (défaut D)');
  ok(estimateTokens('abcd'.repeat(1000)) === 1000, 'estimation ~4 caractères par token');
  ok(estimateTokens('') === 0, 'texte vide → 0 token');
  ok(cacheableMinTokens('claude-haiku-4-5') === 4096, 'minimum cacheable Haiku 4.5 = 4096');
  ok(cacheableMinTokens('claude-sonnet-4-5') === 1024, 'minimum cacheable Sonnet = 1024');
  ok(cacheableMinTokens('modele-inconnu') === 4096, 'modèle inconnu → seuil conservateur (4096)');
  // Le cas réel mesuré dans l'audit : bloc stable de 8 281 caractères ≈ 2 071
  // tokens, sous les 4 096 de Haiku → le cache dort et on doit le SAVOIR.
  ok(estimateTokens('x'.repeat(8281)) < cacheableMinTokens('claude-haiku-4-5'),
    'le bloc stable réel de la prod est bien sous le seuil : le log prompt_cache_inactive a une raison d\'exister');

  // ── KIMI : le fournisseur que le centre PAIE, et qui n'avait aucun gate ────
  // Ce bloc existe a cause d'un defaut mesure sur l'API reelle le 2026-08-14 :
  // K2.6 raisonne, son `reasoning_content` est decompte de max_tokens, et avec
  // les plafonds calibres pour Haiku (900 a 1200) il consommait 899 tokens de
  // raisonnement pour rendre ZERO caractere de contenu. finish_reason
  // « length », JSON invalide, callLlmJson null, et toutes les surfaces
  // marketing retombaient en silence sur leur gabarit. Le provider avait ete
  // ajoute sans une seule assertion : voila pourquoi ca a pu vivre en prod.
  console.log('\n[KIMI] raisonnement coupe, troncature refusee, priorite');
  delete process.env.OPENAI_API_KEY;
  process.env.KIMI_API_KEY = 'test-key-kimi';
  ok(llmProvider('marketing') === 'kimi', 'cle Kimi seule -> kimi');
  ok(llmProvider('sensitive') === 'kimi', 'Kimi sert AUSSI les usages sensibles (fournisseur contractuel)');
  process.env.ANTHROPIC_API_KEY = 'test-key-anthropic';
  ok(llmProvider('marketing') === 'kimi', 'Kimi PRIORITAIRE sur Anthropic : c\'est lui que le centre paie');
  delete process.env.ANTHROPIC_API_KEY;

  const kimiRes = (content, finishReason = 'stop', usage = {}) => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }], usage }),
  });
  const fxK = makeFetch(() => kimiRes('{"content":"Texte Kimi."}'));
  const rK = await callLlmJson({ stableSystem: 'STABLE', system: 'volatile', user: '{"a":1}', schema, maxTokens: 900, fetchImpl: fxK.impl });
  const callK = fxK.calls[0];
  ok(callK.url === 'https://api.moonshot.ai/v1/chat/completions', 'URL Moonshot internationale (.ai, pas .cn)');
  ok(callK.init.headers.Authorization === 'Bearer test-key-kimi', 'header Authorization Bearer');
  ok(callK.body.model === 'kimi-k2.6' && callK.body.max_tokens === 900, `model + max_tokens (${callK.body.model}, ${callK.body.max_tokens})`);
  ok(callK.body.thinking && callK.body.thinking.type === 'disabled',
    'LE RAISONNEMENT EST COUPE : sans thinking.type=disabled, 899 tokens partent en reflexion et le contenu sort vide');
  ok(callK.body.response_format && callK.body.response_format.type === 'json_object', 'mode JSON demande quand un schema est attendu');
  ok(callK.body.messages[0].role === 'system' && callK.body.messages[0].content.includes('STABLE') && callK.body.messages[0].content.includes('volatile'), 'system = stable + volatile concatenes');
  // Ce dialecte n'a AUCUN champ pour porter un schema : s'il n'est pas dans le
  // prompt, il n'existe pas. Constate en reel : le modele rendait un objet de
  // son invention, avec le seul champ qu'il jugeait utile, et les surfaces
  // affichaient des valeurs par defaut sans que rien ne signale l'ecart.
  ok(callK.body.messages[0].content.includes(JSON.stringify(schema)),
    'LE SCHEMA EST DANS LE PROMPT : sans lui, response_format json_object demande « du JSON », jamais CE JSON');
  const fxKnoSchema = makeFetch(() => kimiRes('texte libre'));
  await callLlm({ user: 'u', fetchImpl: fxKnoSchema.impl });
  ok(!fxKnoSchema.calls[0].body.response_format && !/required/.test(fxKnoSchema.calls[0].body.messages[0] ? fxKnoSchema.calls[0].body.messages[0].content : ''),
    'CONTRE-PREUVE : sans schema demande, aucune consigne JSON n\'est ajoutee (le mode texte libre reste libre)');
  ok(rK && rK.content === 'Texte Kimi.' && rK._provider === 'kimi' && rK._model === 'kimi-k2.6', 'reponse parsee + _provider/_model');

  const fxKcut = makeFetch(() => kimiRes('{"content":"phrase coupee en plein mi', 'length'));
  ok((await callLlm({ user: 'u', fetchImpl: fxKcut.impl })) === null,
    'finish_reason « length » -> null : une phrase coupee en deux ne va JAMAIS sur une surface');
  // Contre-preuve : c'est bien finish_reason qui decide, pas la forme du texte.
  // Le MEME contenu, rendu avec finish_reason « stop », doit passer. Sans cette
  // ligne, un refus qui viendrait d'ailleurs (texte vide, parse rate) passerait
  // pour une garde anti-troncature qui n'existe pas.
  const fxKsame = makeFetch(() => kimiRes('{"content":"phrase coupee en plein mi', 'stop'));
  const rKsame = await callLlm({ user: 'u', fetchImpl: fxKsame.impl });
  ok(rKsame && rKsame.text === '{"content":"phrase coupee en plein mi',
    'CONTRE-PREUVE : le meme texte avec finish_reason « stop » PASSE (c\'est bien la troncature qui bloque)');

  // Le plafond de cadence du compte : TROIS requetes par minute au niveau de
  // l'organisation (mesure le 2026-08-14 : le 4e appel repart en 429 en 200 ms).
  // Sans reprise, ce 429 devenait un null muet et la surface retombait sur son
  // gabarit. C'est la cause dominante du « toujours la meme chose ».
  let servedK = 0;
  const fxK429 = makeFetch(() => {
    servedK += 1;
    return servedK <= 2 ? { status: 429, ok: false, json: async () => ({}) } : { status: 200, ...kimiRes('{"content":"apres la fenetre"}') };
  });
  const r429 = await callLlmJson({ user: 'u', schema, fetchImpl: fxK429.impl, retryWaitsMs: [5, 10] });
  ok(r429 && r429.content === 'apres la fenetre' && servedK === 3,
    `429 puis 429 puis 200 : l'appel REESSAIE et aboutit (${servedK} tentatives)`);
  let servedAll429 = 0;
  const fxK429all = makeFetch(() => { servedAll429 += 1; return { status: 429, ok: false, json: async () => ({}) }; });
  const rAll429 = await callLlm({ user: 'u', fetchImpl: fxK429all.impl, retryWaitsMs: [5, 10] });
  ok(rAll429 === null && servedAll429 === 3,
    `429 sans fin : le nombre de tentatives est BORNE (${servedAll429}), la fonction ne part pas en salle d'attente`);
  let servedFail = 0;
  const fxK500 = makeFetch(() => { servedFail += 1; return { status: 500, ok: false, json: async () => ({}) }; });
  ok((await callLlm({ user: 'u', fetchImpl: fxK500.impl, retryWaitsMs: [5, 10] })) === null && servedFail === 1,
    'CONTRE-PREUVE : une erreur 500 n\'est PAS reessayee (seul le plafond de cadence l\'est)');

  llmBudget.__resetForTests();
  const beforeK = llmBudget.getMonthlySpend();
  const fxKspend = makeFetch(() => kimiRes('coupe', 'length', { prompt_tokens: 100000, completion_tokens: 50000 }));
  await callLlm({ user: 'u', fetchImpl: fxKspend.impl });
  const spentK = llmBudget.getMonthlySpend() - beforeK;
  // 100k in x 0.95/M + 50k out x 4/M = 0.095 + 0.20 = 0.295 $
  ok(Math.abs(spentK - 0.295) < 1e-9,
    `une sortie TRONQUEE est quand meme facturee, donc quand meme comptee (attendu 0.295, obtenu ${spentK})`);
  llmBudget.__resetForTests();
  delete process.env.KIMI_API_KEY;

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
