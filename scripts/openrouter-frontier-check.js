// LA FRONTIERE DES DONNEES, prouvee et non promise.
//
// Un compte OpenRouter sans credits n'ouvre que les modeles « :free », et pour
// ceux-la les fournisseurs peuvent exploiter les requetes. Le site promet
// « vos donnees restent les votres » et la FAQ « aucune revente, aucun
// partage » : l'agent qui lit les COURRIELS des clients ne doit donc jamais
// sortir vers ce chemin.
//
// Ce gate verifie la propriete par le COMPORTEMENT (quel fournisseur est
// choisi, quelle URL est appelee), pas par la lecture du code : et il se
// contre-prouve : il verifie aussi qu'un usage autorise passe BIEN par
// OpenRouter, sinon un aiguillage casse rendrait le test vert pour rien.
const assert = require('assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
let echecs = 0;
const ok = (condition, message) => {
  if (condition) { console.log('ok    ' + message); return; }
  echecs += 1;
  console.log('FAIL  ' + message);
};

// Environnement de test : les deux fournisseurs presents, OpenRouter force.
process.env.ANTHROPIC_API_KEY = 'test-anthropic';
process.env.OPENROUTER_API_KEY = 'test-openrouter';
process.env.LLM_PROVIDER = 'openrouter';
process.env.LLM_MONTHLY_BUDGET_EUR = '5';

const client = require(path.join(RACINE, 'lib', 'llm-client'));

console.log('\n[1] Le choix du fournisseur suit la NATURE de l appel');
ok(client.llmProvider('marketing') === 'openrouter',
  'un appel marketing (aucune donnee personnelle) sort vers OpenRouter');
ok(client.llmProvider('content') === 'openrouter',
  'un appel de redaction sort vers OpenRouter');
ok(client.llmProvider('sensitive') === 'anthropic',
  'un appel sensible reste chez le fournisseur contractuel');
ok(client.llmProvider(undefined) === 'anthropic',
  'un appel qui ne declare RIEN est traite comme sensible (defaut protecteur)');
ok(client.llmProvider('courriel') === 'anthropic',
  'un usage inconnu ne s ouvre pas tout seul');

console.log('\n[2] L URL reellement appelee, pas celle qu on croit');
async function urlAppelee(usage) {
  let vue = null;
  const faux = async (url) => {
    vue = url;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        content: [{ text: 'ok' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, input_tokens: 10, output_tokens: 5 },
      }),
    };
  };
  await client.callLlm({ user: 'test', maxTokens: 10, timeoutMs: 500, fetchImpl: faux, usage });
  return vue;
}

(async () => {
  const marketing = await urlAppelee('marketing');
  const sensible = await urlAppelee('sensitive');
  ok(/openrouter\.ai/.test(String(marketing)),
    `l appel marketing part bien vers OpenRouter (${marketing})`);
  ok(/api\.anthropic\.com/.test(String(sensible)),
    `l appel sensible part vers Anthropic (${sensible})`);
  ok(!/openrouter\.ai/.test(String(sensible)),
    'AUCUNE donnee sensible ne part vers OpenRouter');

  console.log('\n[3] L agent courriel ne declare aucun usage (donc reste protege)');
  const fs = require('fs');
  const source = fs.readFileSync(path.join(RACINE, 'lib', 'email-agent.js'), 'utf8');
  const apresAppel = source.split('callLlmJson({')[1] || '';
  ok(!/usage\s*:/.test(apresAppel.slice(0, 400)),
    'email-agent.js ne declare pas d usage : il retombe sur le defaut sensible');

  console.log('\n[4] Le cout est compte meme quand il est nul');
  const budget = require(path.join(RACINE, 'lib', 'llm-budget'));
  ok(budget.computeOpenRouterCallCost({ prompt_tokens: 1000, completion_tokens: 500 }, 'x/y:free') === 0,
    'un modele gratuit coute zero');
  ok(budget.computeOpenRouterCallCost({ prompt_tokens: 1000, completion_tokens: 500 }, 'modele/inconnu') > 0,
    'un modele inconnu est facture au tarif le plus cher connu (on ne sous-estime jamais)');

  console.log(echecs ? `\nopenrouter-frontier-check: ${echecs} FAIL` : '\nopenrouter-frontier-check: ALL OK - la frontiere des donnees tient.');
  process.exit(echecs ? 1 : 0);
})();
