// Gate du studio de contenu (lib/content-studio). Zéro réseau, zéro DB :
// bundle et modèle IA injectés. Couvre : angle du jour (priorités), pack
// règles complet, boucle de raffinement (faible → fixes → fort), rejet des
// packs bloqués (claims interdits), persistance, packs du jour, erreurs.
let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const {
  STUDIO_CHANNELS,
  generateContentPack,
  listTodayPacks,
  pickStudioTheme,
  buildRulesPack,
  shortVersionOf,
} = require('../lib/content-studio');
const { buildCenterFacts } = require('../lib/marketing-agents');
const { resolveOccasion } = require('../lib/fungalaxy-brand');

(async () => {
  console.log('[ANGLE DU JOUR] priorités météo > événement > vacances > saison');
  const today = '2026-07-16';
  ok(pickStudioTheme({ forecast7: [{ date: '2026-07-18', precipMm: 14, tmax: 20 }], localEvents: [{ label: 'Foire', from: '2026-07-24', to: '2026-07-27' }] }, today).id === 'rain', 'pluie prioritaire');
  ok(pickStudioTheme({ forecast7: [{ date: '2026-07-18', precipMm: 0, tmax: 28 }] }, today).id === 'heat', 'chaleur ensuite');
  const eventTheme = pickStudioTheme({ forecast7: [], localEvents: [{ label: 'Foire de Libramont', from: '2026-07-24', to: '2026-07-27' }] }, today);
  ok(eventTheme.id === 'local_event' && eventTheme.label.includes('24/07'), 'événement local, dates humaines');
  ok(pickStudioTheme({}, today).id === 'seasonal', 'sinon accroche de saison');

  console.log('\n[PACK RÈGLES] complet sans clé IA');
  const centerFacts = buildCenterFacts('libramont');
  const occasion = resolveOccasion('anniversaire_enfant');
  const rules = buildRulesPack({ channel: 'facebook', centerFacts, occasion, theme: { label: 'test', facts: {} } });
  ok(Boolean(rules.long && rules.short && rules.story && rules.photoIdea && rules.aiImagePrompt && rules.bestTime), 'toutes les pièces du pack présentes');
  ok(/no text, no logos$/.test(rules.aiImagePrompt), 'prompt image IA en anglais, termine par no text/no logos');
  ok(rules.hashtags.length >= 4 && rules.hashtags.every((tag) => tag.startsWith('#')), 'hashtags valides');
  ok(rules.short.length < rules.long.length, 'la courte est plus courte que la longue');
  ok(shortVersionOf('Ligne un du post\nLigne deux\nLigne trois', 'Réserve') === 'Ligne un du post\nRéserve.', 'version courte = hook + CTA');

  console.log('\n[BOUCLE] raffinement faible → corrections → fort');
  const inserted = [];
  const query = async (text, params) => {
    if (String(text).includes('insert into marketing_agent_runs')) inserted.push(params);
    return { rows: [] };
  };
  const bundle = { today, forecast7: [{ date: '2026-07-18', precipMm: 14, tmax: 20 }], localEvents: [], nextSchoolHoliday: null };
  const weakPack = {
    long: 'Venez découvrir notre centre. Une expérience inoubliable vous attend vraiment ici même.',
    short: 'Venez nous voir.',
    story: 's', photoIdea: 'p', aiImagePrompt: 'prompt, no text, no logos', hashtags: ['#a'], bestTime: '17h',
  };
  const strongPack = {
    long: 'Il pleut samedi ? À Libramont, nos 8 pistes de bowling et le laser game sont bien au sec — note 4.8/5 par les familles du coin.\n\nRéservez votre piste, ça prend 30 secondes.',
    short: 'Pluie samedi ? Bowling au sec à Libramont — réservez votre piste.',
    story: 'Pluie samedi ?\n→ Réserve ta piste.',
    photoIdea: 'Filmer l\'arrivée d\'un groupe sous la pluie puis le strike.',
    aiImagePrompt: 'Rainy day outside a bowling center, cozy neon interior, no text, no logos',
    hashtags: ['#bowling', '#libramont', '#lasergame', '#pluie', '#famille'],
    bestTime: '17h-19h',
  };
  const modelCalls = [];
  const fakeModel = async ({ fixes }) => {
    modelCalls.push(fixes);
    return modelCalls.length === 1 ? weakPack : strongPack;
  };
  const pack = await generateContentPack('libramont', { platform: 'facebook' }, {
    query, bundle, llmProvider: () => 'mock', callPackModel: fakeModel,
  });
  ok(modelCalls.length === 2 && modelCalls[0].length === 0 && modelCalls[1].length >= 1, `2 passes, la 2e reçoit les corrections (${modelCalls[1] && modelCalls[1].length} fixes)`);
  ok(pack.long === strongPack.long && pack.generationMode === 'ai', 'la version forte gagne');
  ok(pack.quality.status === 'ready' && pack.quality.score >= 82, `contrôle qualité ready (${pack.quality.score}/100)`);
  ok(pack.quality.iterations.length === 3, 'itérations tracées (règles + 2 IA)');

  console.log('\n[BLOQUÉ] un claim interdit ne sort JAMAIS');
  const blockedPack = { ...strongPack, long: 'Session laser privée garantie pour votre groupe, disponibilité garantie ce samedi !', short: strongPack.short };
  const pack2 = await generateContentPack('libramont', { platform: 'facebook' }, {
    query, bundle, llmProvider: () => 'mock', callPackModel: async () => blockedPack,
  });
  ok(pack2.generationMode === 'rules', 'pack IA bloqué → le pack règles est servi');
  ok(!/garantie/.test(pack2.long), 'aucun claim interdit dans la sortie');

  console.log('\n[PERSISTANCE]');
  ok(inserted.length === 2, 'chaque génération est persistée');
  const row = inserted[0];
  ok(row[2] === 'facebook' && JSON.parse(row[5]).platform === 'facebook' && JSON.parse(row[5]).quality, 'payload complet (platform + quality)');

  console.log('\n[PACKS DU JOUR]');
  const packsQuery = async () => ({ rows: [{ platform: 'instagram', payload: { long: 'x', platform: 'instagram' } }] });
  const packs = await listTodayPacks('libramont', { query: packsQuery });
  ok(STUDIO_CHANNELS.every((channel) => channel in packs), 'tous les canaux présents');
  ok(packs.instagram && packs.instagram.long === 'x' && packs.facebook === null, 'pack existant mappé, absent = null');

  console.log('\n[ERREURS]');
  let badChannel = false;
  try { await generateContentPack('libramont', { platform: 'myspace' }, { query, bundle }); } catch (e) { badChannel = e.statusCode === 400; }
  ok(badChannel, 'canal inconnu → 400');

  if (failures) { console.error(`\ncontent-studio-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncontent-studio-check: ALL OK');
})().catch((error) => { console.error('content-studio-check CRASH:', error.stack || error.message); process.exit(1); });
