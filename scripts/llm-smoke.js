// Smoke-test RÉEL du client LLM : 1 appel minuscule (~300 tokens, ~0,001 $).
// À lancer après avoir posé ANTHROPIC_API_KEY (ou OPENAI_API_KEY) :
//   node scripts/llm-smoke.js
// Lit .env local si les variables ne sont pas déjà dans l'environnement.
// N'affiche JAMAIS une clé : uniquement provider/modèle/résultat.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const { llmProvider, callLlmJson } = require('../lib/llm-client');

(async () => {
  const provider = llmProvider();
  if (!provider) {
    console.log('Aucune clé IA détectée (ANTHROPIC_API_KEY / OPENAI_API_KEY absentes de l\'env et du .env).');
    console.log('Pose la clé puis relance : node scripts/llm-smoke.js');
    process.exit(1);
  }
  console.log(`Provider actif : ${provider}`);
  const result = await callLlmJson({
    stableSystem: 'Tu réponds en JSON conforme au schéma, en français, en une phrase.',
    user: 'Dis bonjour au centre Fun Galaxy de Libramont.',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    schemaName: 'smoke',
    maxTokens: 100,
    timeoutMs: 20000,
  });
  if (!result) {
    console.error('ÉCHEC : l\'appel a rendu null (clé invalide, réseau, ou refus). Vérifie la clé.');
    process.exit(1);
  }
  console.log(`Modèle : ${result._model}`);
  console.log(`Réponse : ${result.message}`);
  console.log('llm-smoke: OK, le chemin IA est opérationnel.');
})();
