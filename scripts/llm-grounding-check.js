// Test d'ANCRAGE FACTUEL sur la VRAIE IA (pas des mocks).
//
// Pourquoi ce fichier existe : les mocks testent la plomberie, pas la sortie.
// Toute la suite marketing etait verte pendant que l'IA ecrivait, en prod, des
// posts qui promettaient des activites que Fun Galaxy ne possede pas et qui
// attribuaient a Libramont la note Google de Gembloux. Un test qui ne fait pas
// parler le vrai modele ne peut pas attraper ca.
//
// Ce que ce test verifie, sur les DEUX centres, sur une vraie generation :
//  1. Zero tiret cadratin (marqueur IA numero 1).
//  2. Zero activite inventee : chaque centre a ses interdits, derives de
//     centers.json (Libramont n'a pas Golf o'Clock, Gembloux n'a pas de
//     duckpin ni de plaine de jeux).
//  3. Zero note transportee : Libramont n'a AUCUNE note publiee, la 4.8/5 est
//     celle de Gembloux. Elle ne doit jamais apparaitre chez Libramont.
//  4. Le post parle d'au moins une activite reellement disponible dans CE centre.
//
// Cout : ~0,002 $ par run (2 appels Haiku, prompt cache). Le budget est plafonne
// par lib/llm-budget.js de toute facon.
//
// Sans cle : SKIP propre (exit 0). Le gate CI ne depend donc pas d'un secret.
const fs = require('fs');
const path = require('path');

for (const file of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const { llmProvider } = require('../lib/llm-client');
const { buildCenterFacts } = require('../lib/marketing-agents');
const { generateContentPack } = require('../lib/content-studio');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log(`ok    ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

// Interdits explicites par centre : ce que le centre NE possede PAS.
const CENTERS = {
  libramont: {
    banned: [/golf\s*o.?clock/i, /karting/i, /lancer de hache/i, /fl[ée]chettes/i, /free\s*roaming/i, /4[.,]8/],
    expectOneOf: [/bowling/i, /laser/i, /minigolf/i, /arcade/i, /plaine de jeux|playground/i, /duckpin/i, /billard/i],
  },
  gembloux: {
    banned: [/duckpin/i, /plaine de jeux|playground/i, /fun run/i, /karting/i, /lancer de hache/i, /fl[ée]chettes/i, /free\s*roaming/i],
    expectOneOf: [/bowling/i, /laser/i, /minigolf/i, /golf\s*o.?clock/i, /arcade/i, /billard/i],
  },
};

(async () => {
  if (!llmProvider()) {
    console.log('llm-grounding-check: SKIP (aucune cle IA dans l\'environnement).');
    process.exit(0);
  }

  // Pas de DB requise : le bandit et les stats sont fail-soft, on injecte.
  const deps = {
    query: async () => ({ rows: [] }),
    recommendAngle: async () => null,
  };

  for (const [centerId, spec] of Object.entries(CENTERS)) {
    console.log(`\n[${centerId.toUpperCase()}] generation reelle (facebook)`);
    const facts = await buildCenterFacts(centerId, deps).catch(() => null);
    if (!facts) { ok(false, `${centerId} : faits du centre construits`); continue; }

    let pack = null;
    try {
      pack = await generateContentPack(centerId, { platform: 'facebook', brief: 'Un post pour ce week-end.' }, deps);
    } catch (err) {
      ok(false, `${centerId} : la generation aboutit`, String(err && err.message));
      continue;
    }

    const text = [pack && pack.long, pack && pack.short, pack && pack.story].filter(Boolean).join('\n');
    ok(Boolean(text.trim()), `${centerId} : le pack contient du texte`);
    if (!text.trim()) continue;

    console.log(`      mode: ${pack.generationMode} | score: ${pack.quality && pack.quality.score}`);
    console.log(`      "${(pack.long || '').split('\n')[0].slice(0, 100)}"`);

    ok(!/[—–]/.test(text), `${centerId} : zero tiret cadratin dans la sortie IA`,
      /[—–]/.test(text) ? text.split('\n').find((l) => /[—–]/.test(l)) : '');

    const hit = spec.banned.find((re) => re.test(text));
    ok(!hit, `${centerId} : aucune activite/preuve inventee`,
      hit ? `motif interdit trouve : ${hit} dans "${(text.match(hit) || [])[0]}"` : '');

    ok(spec.expectOneOf.some((re) => re.test(text)), `${centerId} : cite une activite reellement disponible ici`);

    // La ville ancre le post : c'est la regle du playbook.
    ok(new RegExp(facts.city, 'i').test(text), `${centerId} : la ville du centre est citee`);
  }

  console.log(`\nllm-grounding-check: ${failures ? `${failures} FAIL` : 'ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('llm-grounding-check: CRASH', err && err.message);
  process.exit(1);
});
