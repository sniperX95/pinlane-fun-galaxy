// Gate du Brief (lib/marketing-brief) — l'agrégateur de la refonte Marketing.
// Zéro réseau, zéro DB : moteurs et query injectés. Couvre EN PRIORITÉ le
// dédoublonnage brain/cron (exigence de la spec), puis le composeur du brief,
// les reçus honnêtes, le bundle complet, et l'intégrité des actions (publiée
// = seule porte vers la mesure J+14, refus, variante, création).
let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const {
  mergePropositions,
  composeBriefText,
  dayExplanation,
  receiptFromInsight,
  propositionFromInsight,
  propositionFromPlanAction,
  propositionFromDailyPost,
  buildMarketingBriefBundle,
  propositionAction,
  createProposition,
  tenantNetworks,
} = require('../lib/marketing-brief');

(async () => {
  console.log('[DÉDOUBLONNAGE] le chantier critique de la spec');
  const cronIdea = propositionFromInsight({
    id: 11, kind: 'idea', title: 'Post plan pluie', body: 'Pluie vendredi.', channel: 'facebook',
    ready_content: 'Texte cron.', signature: 'rain_forecast:facebook', status: 'proposed',
    payload: {}, due_date: '2026-07-18',
  });
  const planAction = propositionFromPlanAction({
    id: 'social:2026-07-18', type: 'social_push', channel: 'instagram',
    executeOn: '2026-07-16', targetDate: '2026-07-18',
    title: 'Post pour remplir vendredi', why: '12 visiteurs attendus (médiane 40).', readyContent: 'Texte plan.',
  });
  // Collision voulue : même jour cible, même déclencheur ? cron=pluie, plan=creux
  // → PAS de collision (déclencheurs différents) : les deux vivent.
  const noCollision = mergePropositions({ fromDb: [cronIdea], fromPlan: [planAction] });
  ok(noCollision.length === 2, 'déclencheurs différents sur le même jour → deux cartes');
  // Vraie collision : cron « quiet_day » vs plan « creux » sur le même jour.
  const cronQuiet = propositionFromInsight({
    id: 12, kind: 'idea', title: 'Offre mardi creux', body: 'Mardi faible.', channel: 'email',
    ready_content: 'Texte cron creux.', signature: 'quiet_day:email', status: 'proposed',
    payload: {}, due_date: '2026-07-18',
  });
  const collision = mergePropositions({ fromDb: [cronQuiet], fromPlan: [planAction] });
  ok(collision.length === 1 && collision[0].whyShort === 'Post pour remplir vendredi', 'même jour + même déclencheur → LE PLAN DATÉ GAGNE sur l\'idée du cron');
  // Une proposition PERSISTÉE par le gérant gagne sur le plan volatil.
  const persisted = propositionFromInsight({
    id: 13, kind: 'proposition', title: 'Tu m\'as demandé de remplir vendredi', body: '', channel: 'facebook',
    ready_content: 'Texte demandé.', signature: 'demande:x', status: 'proposed',
    payload: { trigger: 'creux' }, due_date: '2026-07-18',
  });
  const userWins = mergePropositions({ fromDb: [persisted], fromPlan: [planAction] });
  ok(userWins.length === 1 && userWins[0].id === 13, 'la proposition persistée par le gérant gagne sur le plan volatil');
  // La proposition du jour épinglée passe en tête et absorbe sa collision.
  const daily = propositionFromDailyPost({ themeId: 'rain', reason: 'Pluie vendredi — on poste avant.', caption: 'Légende.', hashtags: ['#a'], visualBrief: 'À filmer : x', bestTime: '17h' }, '2026-07-16');
  const withDaily = mergePropositions({ fromDb: [cronIdea], fromPlan: [planAction], daily });
  ok(withDaily[0].pinned === true && withDaily[0].key === 'daily', 'proposition du jour épinglée en tête');
  const capped = mergePropositions({ fromDb: Array.from({ length: 10 }, (_, i) => ({ ...cronIdea, key: `db:${i}`, id: i, dueDate: `2026-07-2${i % 10}`, trigger: `t${i}` })), fromPlan: [] });
  ok(capped.length === 6, 'cap à 6 propositions actives');

  console.log('\n[BRIEF] le composeur de phrases');
  const outlook = [
    { date: '2026-07-17', level: 'normal', drivers: [], precipMm: null, booked: null },
    { date: '2026-07-19', level: 'creux', drivers: ['jour structurellement faible'], precipMm: null, booked: null },
  ];
  const text = composeBriefText({ outlook, propositions: [{ kind: 'post' }, { kind: 'post' }, { kind: 'email' }], competitorsChanged: [{ name: 'Bowling Arlon' }] });
  ok(/[Dd]imanche 19\/07/.test(text) && text.includes('calme'), 'phrase 1 : ce que j\'ai vu (le creux)');
  ok(text.includes('2 posts') && text.includes('un email'), 'phrase 2 : ce que j\'ai préparé');
  ok(text.includes('Bowling Arlon'), 'phrase 3 : la veille');
  ok(composeBriefText({}) .includes('Rien à signaler'), 'brief vide assumé');
  const explain = dayExplanation({ date: '2026-07-23', level: 'calme', drivers: ['pluie prévue (12 mm) : +25 % observé chez toi'], booked: { pax: 14 } });
  ok(explain.startsWith('Jeudi 23/07 : calme attendu') && explain.includes('14 résas'), `explication de cellule humaine (${explain.slice(0, 40)}…)`);

  console.log('\n[REÇUS] honnêtes, jamais de faux euros');
  const good = receiptFromInsight({ id: 1, title: 'Post pluie', status: 'validated', applied_at: '2026-07-03T10:00:00Z', result: { deltaPct: 22 } });
  ok(good.tone === 'good' && good.result === '+22 % de monde' && good.redoable, 'validé → +X % de monde + refaisable');
  const flat = receiptFromInsight({ id: 2, title: 'Email réactivation', status: 'refuted', applied_at: '2026-06-25T10:00:00Z', result: { deltaPct: -4 } });
  ok(flat.tone === 'neutral' && flat.result === 'pas d\'effet mesurable' && !flat.redoable, 'réfuté → neutre (jamais rouge), pas refaisable');
  const pending = receiptFromInsight({ id: 3, title: 'Post soirée fluo', status: 'applied', applied_at: '2026-07-12T10:00:00Z', result: null });
  ok(pending.tone === 'pending' && /verdict le/.test(pending.result), `en mesure → « ${pending.result} »`);

  console.log('\n[BUNDLE] un seul GET, tout le mémo');
  const fakeBrain = {
    today: '2026-07-16', dataDays: 90, medianVisitors: 40,
    outlook: Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 16 + i, 12));
      return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), level: i === 3 ? 'creux' : 'normal', tmax: 20, precipMm: i === 2 ? 12 : 0, drivers: i === 3 ? ['jour faible'] : [], booked: i === 5 ? { pax: 34, reservations: 6 } : null };
    }),
    explainPast: [],
    plan: [{ id: 'social:2026-07-19', type: 'social_push', channel: 'instagram', executeOn: '2026-07-16', targetDate: '2026-07-19', title: 'Post pour remplir dimanche', why: '12 attendus.', readyContent: 'Texte.' }],
    instagram: { themeId: 'rain', reason: 'Pluie samedi.', caption: 'Légende du jour.', hashtags: ['#x'], visualBrief: 'À filmer : y', bestTime: '17h-19h' },
  };
  const bundle = await buildMarketingBriefBundle('libramont', { days: 30 }, {
    buildMarketingBrain: async () => fakeBrain,
    computeMarketingRoi: async () => ({ revenue: 1240, conversions: 5, sent: 17, reviewClicks: 4, days: 30, bySource: [{ key: 'birthday_j30', label: 'Anniversaires', sent: 12, conversions: 3, revenue: 770 }] }),
    listMarketingInsights: async () => [
      { id: 21, kind: 'idea', title: 'Post Foire', body: 'Foire à 5 min.', channel: 'facebook', ready_content: 'T.', signature: 'local_event:facebook', status: 'proposed', payload: {}, due_date: null },
      { id: 22, kind: 'idea', title: 'Post pluie', body: '', channel: 'facebook', ready_content: 'T.', signature: 'rain_forecast:facebook', status: 'validated', applied_at: '2026-07-01T08:00:00Z', result: { deltaPct: 18 }, payload: {} },
    ],
    query: async (text) => (String(text).includes('count(*)') ? { rows: [{ count: 2 }] } : { rows: [{ name: 'Bowling Arlon', diff_summary: 'Nouvelle offre étudiants.', fetched_at: '2026-07-16T02:00:00Z' }] }),
    skipPolish: true,
    llmProvider: () => null,
  });
  ok(bundle.ok && bundle.radar.length === 14 && bundle.paie.euros === 1240, 'bundle : paie + radar 14 j');
  ok(bundle.propositions[0].pinned && bundle.propositions.some((p) => p.id === 21), 'file : épinglée en tête + idée cron présente');
  ok(bundle.radar[3].propositionKey === 'plan:social:2026-07-19', 'le radar pointe vers la proposition qui vise le jour creux');
  ok(bundle.brief.text.includes('préparé') && bundle.brief.degraded === true, 'brief composé + flag dégradé sans IA');
  ok(bundle.receipts.length === 1 && bundle.receipts[0].result === '+18 % de monde', 'reçus mesurés');
  ok(bundle.veille.count === 2 && bundle.veille.changed[0].name === 'Bowling Arlon', 'veille résumée');
  ok(bundle.paie.young === false && tenantNetworks('libramont').join(',') === 'facebook,instagram,story', 'réseaux du tenant (TikTok/LinkedIn masqués)');

  console.log('\n[ACTIONS] intégrité de la mesure');
  const log = [];
  const actionQuery = async (text, params) => {
    const sql = String(text);
    log.push({ sql, params });
    if (sql.trim().startsWith('select id from marketing_insights')) return { rows: [] };
    if (sql.trim().startsWith('insert')) return { rows: [{ id: 77 }] };
    return { rows: [] };
  };
  const published = await propositionAction('libramont', {
    action: 'publiee',
    proposition: { trigger: 'creux', whyShort: 'Post', why: 'x', dueDate: '2026-07-19', kind: 'post', network: 'facebook', networks: { facebook: { text: 'T' } }, signature: 'plan:social:2026-07-19' },
  }, { query: actionQuery });
  ok(published.ok && published.status === 'publiee', 'volatile → persistée puis publiée');
  const updateSql = log.find((l) => l.sql.includes("status = 'applied'"));
  ok(Boolean(updateSql) && updateSql.sql.includes('applied_at = now()'), 'publiée = applied + applied_at (la fenêtre J+14 s\'ouvre)');
  const refused = await propositionAction('libramont', { action: 'refusee', id: 42 }, { query: actionQuery });
  ok(refused.status === 'refusee' && log.some((l) => l.sql.includes("'ignored'")), 'refusée → ignored');
  let badAction = false;
  try { await propositionAction('libramont', { action: 'hack' }, { query: actionQuery }); } catch (e) { badAction = e.statusCode === 400; }
  ok(badAction, 'action inconnue → 400');
  const variantLog = [];
  const variant = await propositionAction('libramont', { action: 'variante', id: 42, network: 'story' }, {
    query: async (text, params) => { variantLog.push({ sql: String(text), params }); return { rows: [{ id: 42 }] }; },
    generateContentPack: async (centerId, { platform }) => ({ long: 'L', story: 'Texte story.', hashtags: ['#a'], photoIdea: 'p', aiImagePrompt: 'i', bestTime: '18h', quality: {}, platform }),
  });
  ok(variant.network === 'story' && variant.entry.text === 'Texte story.', 'variante story → texte story du pack');
  ok(variantLog.some((l) => l.sql.includes("jsonb_build_object('networks'")), 'payload réseau mis à jour en DB');

  console.log('\n[CRÉATION]');
  let emptyRejected = false;
  try { await createProposition('libramont', { brief: '', targetDate: null }, { query: actionQuery }); } catch (e) { emptyRejected = e.expose === true; }
  ok(emptyRejected, 'demande vide → message clair');
  const created = await createProposition('libramont', { brief: 'un post pour la soirée fluo', targetDate: null }, {
    query: actionQuery,
    generateContentPack: async () => ({ long: 'Post fluo.', hashtags: ['#fluo'], photoIdea: 'p', aiImagePrompt: 'i', bestTime: '18h' }),
  });
  ok(created.ok && created.id === 77, 'demande libre → proposition créée');
  const fillDay = await createProposition('libramont', { brief: '', targetDate: '2026-07-19', trigger: 'creux' }, {
    query: actionQuery,
    generateContentPack: async () => ({ long: 'Post remplissage.', hashtags: [], photoIdea: '', aiImagePrompt: '', bestTime: '' }),
  });
  ok(fillDay.ok, 'radar « remplir ce jour » → proposition créée avec date cible');

  if (failures) { console.error(`\nmarketing-brief-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nmarketing-brief-check: ALL OK');
})().catch((error) => { console.error('marketing-brief-check CRASH:', error.stack || error.message); process.exit(1); });
