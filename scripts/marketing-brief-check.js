// Gate du Brief (lib/marketing-brief) : l'agrégateur de la refonte Marketing.
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
  const daily = propositionFromDailyPost({ themeId: 'rain', reason: 'Pluie vendredi, on poste avant.', caption: 'Légende.', hashtags: ['#a'], visualBrief: 'À filmer : x', bestTime: '17h' }, '2026-07-16');
  const withDaily = mergePropositions({ fromDb: [cronIdea], fromPlan: [planAction], daily });
  ok(withDaily[0].pinned === true && withDaily[0].key === 'daily', 'proposition du jour épinglée en tête');
  const capped = mergePropositions({ fromDb: Array.from({ length: 10 }, (_, i) => ({ ...cronIdea, key: `db:${i}`, id: i, dueDate: `2026-07-2${i % 10}`, trigger: `t${i}` })), fromPlan: [] });
  ok(capped.length === 6, 'cap à 6 propositions actives');

  console.log('\n[FUSION] les 4 findings de la revue adversariale');
  // Finding 2 : deux demandes libres SANS date ne s'écrasent plus.
  const demandeA = propositionFromInsight({ id: 51, kind: 'proposition', title: 'post anniversaire', body: '', channel: 'facebook', ready_content: 'A', signature: 'demande:a', status: 'proposed', payload: { trigger: 'demande' }, due_date: null });
  const demandeB = propositionFromInsight({ id: 52, kind: 'proposition', title: 'post promo laser', body: '', channel: 'facebook', ready_content: 'B', signature: 'demande:b', status: 'proposed', payload: { trigger: 'demande' }, due_date: null });
  const twoDemandes = mergePropositions({ fromDb: [demandeA, demandeB], fromPlan: [] });
  ok(twoDemandes.length === 2, 'finding 2 : deux demandes libres sans date cohabitent (aucune jetée)');
  // Finding 1 : une volatile dont la signature est déjà ACTIONNÉE ne réapparaît pas.
  const actioned = new Set(['plan:social:2026-07-18']);
  const skipped = mergePropositions({ fromDb: [], fromPlan: [planAction], actionedSignatures: actioned });
  ok(skipped.length === 0, 'finding 1 : plan publié/refusé (signature actionnée) → ne revient JAMAIS');
  const dailyActioned = mergePropositions({ fromDb: [], fromPlan: [], daily, actionedSignatures: new Set([daily.signature]) });
  ok(dailyActioned.length === 0, 'finding 1 : post du jour déjà publié → pas de résurrection');
  // Finding 4 : le plan persisté (après variante) + sa jumelle volatile → UNE carte.
  const persistedPlan = propositionFromInsight({ id: 61, kind: 'proposition', title: 'Post pour remplir vendredi', body: '', channel: 'instagram', ready_content: 'enrichi', signature: 'plan:social:2026-07-18', status: 'proposed', payload: { trigger: 'creux', targetDate: '2026-07-18', networks: { facebook: { text: 'fb' }, story: { text: 'st' } } }, due_date: '2026-07-16' });
  const noDup = mergePropositions({ fromDb: [persistedPlan], fromPlan: [planAction] });
  ok(noDup.length === 1 && noDup[0].id === 61 && noDup[0].networks.story, 'finding 4 : plan persisté enrichi + volatile → UNE carte (la persistée, avec sa variante Story)');
  // Finding 3 : le post du jour enrichi (persisté) est épinglé, pas écrasé.
  const persistedDaily = propositionFromInsight({ id: 71, kind: 'proposition', title: 'Pluie, au sec', body: '', channel: 'instagram', ready_content: 'enrichi', signature: daily.signature, status: 'proposed', payload: { trigger: 'pluie', networks: { instagram: { text: 'ig' }, story: { text: 'story' } } }, due_date: '2026-07-16' });
  const dailyKept = mergePropositions({ fromDb: [persistedDaily], fromPlan: [], daily });
  ok(dailyKept[0].id === 71 && dailyKept[0].pinned === true && dailyKept[0].networks.story, 'finding 3 : post du jour enrichi épinglé (variante conservée), pas remplacé par la volatile');

  console.log('\n[MAPPING] réseau du plan (finding 8)');
  const igPlan = propositionFromPlanAction({ id: 'social:x', type: 'social_push', channel: 'instagram', executeOn: '2026-07-16', targetDate: '2026-07-18', title: 'Post', why: 'x', readyContent: 'T' });
  ok(igPlan.network === 'instagram' && igPlan.networks.instagram, 'social_push Instagram reste Instagram (pas rangé sous Facebook)');
  const harvest = propositionFromPlanAction({ id: 'harvest:x', type: 'harvest', channel: 'terrain', executeOn: '2026-07-18', targetDate: '2026-07-18', title: 'Récolter', why: 'x', readyContent: 'checklist' });
  ok(harvest.kind === 'offre' && harvest.network === 'interne', 'récolte/offre = rappel interne, pas un post à publier');

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
      { id: 21, kind: 'idea', title: 'Post Foire', body: 'Foire à 5 min.', channel: 'facebook', ready_content: 'T.', signature: 'local_event:facebook', status: 'proposed', payload: {}, due_date: null,
        // La tracabilite telle que le conseiller la fige : chaque fait cite
        // porte sa valeur, son volume et la derivation qui permet de refaire
        // le calcul a la main.
        data_basis: [{ factId: 'creneau_creux', valeur: '11 h : 9 reservations', observations: 9, calcul: 'groupe par heure de start_time, minimum 8 observations' }] },
      // Sa jumelle SANS tracabilite : elle doit arriver dans la file comme les
      // autres, et n afficher aucune preuve. Sans elle, un bloc rendu en dur
      // passerait les assertions ci-dessous.
      { id: 24, kind: 'idea', title: 'Post sans preuve', body: 'Aucune tracabilite.', channel: 'facebook', ready_content: 'T.', signature: 'sans_preuve:facebook', status: 'proposed', payload: {}, due_date: null },
      { id: 22, kind: 'idea', title: 'Post pluie', body: '', channel: 'facebook', ready_content: 'T.', signature: 'rain_forecast:facebook', status: 'validated', applied_at: '2026-07-01T08:00:00Z', result: { deltaPct: 18 }, payload: {} },
      // Une PISTE : proposee comme les autres, mais ce n est pas un texte a
      // publier. Sans genre distinct, propositionFromInsight en ferait un
      // conseil a coller sur Facebook.
      { id: 23, kind: 'piste', title: 'A trancher : le minimum des anniversaires', body: 'concerne 42 sur 500 (8.4 %) | en jeu 51304 EUR | oui : 2 et 6 personnes coexistent deja au catalogue', channel: null, ready_content: null, signature: 'piste:le minimum des anniversaires', status: 'proposed', payload: {}, due_date: null },
    ],
    query: async (text) => (String(text).includes('count(*)') ? { rows: [{ count: 2 }] } : { rows: [{ name: 'Bowling Arlon', diff_summary: 'Nouvelle offre étudiants.', fetched_at: '2026-07-16T02:00:00Z' }] }),
    listDailyMetrics: async () => ({ totals: { visitors: 540, revenue: 8334 }, bestDay: { date: '2026-07-11', revenue_total: 4009, visitors: 234 }, rows: [] }),
    skipPolish: true,
    llmProvider: () => null,
  });
  ok(bundle.ok && bundle.radar.length === 14 && bundle.paie.euros === 1240, 'bundle : paie + radar 14 j');
  ok(bundle.pulse.revenue30 === 8334 && bundle.pulse.visitors30 === 540 && bundle.pulse.avgBasket === 15.4, 'POULS : CA + visiteurs + panier moyen réels (page jamais vide)');
  ok(bundle.pulse.upcomingPax === 34 && bundle.pulse.bestDay.visitors === 234, 'POULS : réservations à venir + meilleure journée');
  ok(bundle.propositions[0].pinned && bundle.propositions.some((p) => p.id === 21), 'file : épinglée en tête + idée cron présente');
  ok(bundle.radar[3].propositionKey === 'plan:social:2026-07-19', 'le radar pointe vers la proposition qui vise le jour creux');
  ok(bundle.brief.text.includes('préparé') && bundle.brief.degraded === true, 'brief composé + flag dégradé sans IA');
  ok(bundle.receipts.length === 1 && bundle.receipts[0].result === '+18 % de monde', 'reçus mesurés');
  ok(bundle.veille.count === 2 && bundle.veille.changed[0].name === 'Bowling Arlon', 'veille résumée');

  // ── LA PREUVE ARRIVE JUSQU AU GERANT ────────────────────────────────────
  // Chaque proposition est stockee avec sa tracabilite pour que le gerant
  // puisse REFAIRE le calcul et prendre l agent en defaut. Elle dormait en
  // base : propositionFromInsight ne lisait meme pas la colonne, donc la carte
  // disait « Voir les faits » sans jamais en montrer un seul.
  const avecPreuve = bundle.propositions.find((proposition) => Number(proposition.id) === 21);
  ok(avecPreuve && Array.isArray(avecPreuve.faits) && avecPreuve.faits.length === 1,
    'la proposition porte les faits qui la soutiennent',
    JSON.stringify(avecPreuve && avecPreuve.faits));
  ok(avecPreuve && avecPreuve.faits[0].valeur === '11 h : 9 reservations',
    'la VALEUR exacte, pas un identifiant technique');
  ok(avecPreuve && avecPreuve.faits[0].observations === 9,
    'le nombre d observations qui la soutient');
  ok(avecPreuve && avecPreuve.faits[0].calcul.includes('groupe par heure'),
    'et la DERIVATION : le calcul se refait a la main');
  // CONTRE-PREUVE : sans tracabilite en base, aucune preuve n est fabriquee.
  const sansPreuve = bundle.propositions.find((proposition) => Number(proposition.id) === 24);
  ok(sansPreuve && Array.isArray(sansPreuve.faits) && sansPreuve.faits.length === 0,
    'CONTRE-PREUVE : une proposition sans tracabilite n en invente aucune',
    JSON.stringify(sansPreuve && sansPreuve.faits));


  // ── UNE PISTE N EST PAS UN POST ─────────────────────────────────────────
  // Le conseiller rend une piste quand il refuse un changement de regle : une
  // question a trancher, avec la population concernee, l argent en jeu et la
  // comparaison deja possible au catalogue. Elle doit atteindre le gerant, et
  // surtout jamais la file des textes a publier.
  ok(bundle.pistes && bundle.pistes.length === 1, 'la piste remonte au gerant, a part');
  ok(bundle.pistes[0].sujet === 'le minimum des anniversaires',
    'son sujet est lisible, sans le prefixe technique');
  ok(String(bundle.pistes[0].pourquoi).includes('coexistent deja au catalogue'),
    'elle porte la comparaison qui existe deja, donc la reponse sans rien changer');
  // LE POINT : aucune proposition ne la reprend. Si elle passait par la file,
  // le gerant verrait « a trancher : le minimum » comme un post a coller.
  ok(!bundle.propositions.some((proposition) => Number(proposition.id) === 23),
    'AUCUNE proposition ne la reprend : elle ne se publie pas',
    JSON.stringify(bundle.propositions.map((proposition) => proposition.id)));
  ok(!JSON.stringify(bundle.propositions).includes('A trancher'),
    'et son titre n apparait nulle part dans la file des posts');
  // CONTRE-PREUVE : les idees ordinaires, elles, sont bien passees par la file.
  // Sans ca, un filtre trop large ferait disparaitre tout le monde.
  ok(bundle.propositions.some((proposition) => Number(proposition.id) === 21),
    'CONTRE-PREUVE : l idee ordinaire reste bien dans la file');

  ok(bundle.paie.young === false && tenantNetworks('libramont').join(',') === 'facebook,instagram,story', 'réseaux du tenant (TikTok/LinkedIn masqués)');

  console.log('\n[ACTIONS] intégrité de la mesure');
  const log = [];
  const actionQuery = async (text, params) => {
    const sql = String(text);
    log.push({ sql, params });
    if (sql.trim().startsWith('select id from marketing_insights')) return { rows: [] };
    if (sql.trim().startsWith('insert')) return { rows: [{ id: 77 }] };
    // UPDATE ... RETURNING id : la garde status='proposed' matche → 1 ligne.
    if (sql.includes('returning id')) return { rows: [{ id: 77 }] };
    return { rows: [] };
  };
  const published = await propositionAction('libramont', {
    action: 'publiee',
    proposition: { trigger: 'creux', whyShort: 'Post', why: 'x', dueDate: '2026-07-19', kind: 'post', network: 'facebook', networks: { facebook: { text: 'T' } }, signature: 'plan:social:2026-07-19' },
  }, { query: actionQuery });
  ok(published.ok && published.status === 'publiee', 'volatile → persistée puis publiée');
  const updateSql = log.find((l) => l.sql.includes("status = 'applied'"));
  ok(Boolean(updateSql) && updateSql.sql.includes('applied_at = now()') && updateSql.sql.includes("status = 'proposed'"), 'publiée = applied + applied_at, GARDÉE sur status proposed (finding 6)');
  const refused = await propositionAction('libramont', { action: 'refusee', id: 42 }, { query: actionQuery });
  ok(refused.status === 'refusee' && log.some((l) => l.sql.includes("'ignored'") && l.sql.includes("status = 'proposed'")), 'refusée → ignored, gardée sur proposed');
  // Republier une carte déjà traitée (0 ligne matchée) → 409, jamais d'écrasement du verdict.
  const guardQuery = async (text) => (String(text).includes('returning id') ? { rows: [] } : { rows: [{ id: 5 }] });
  let republishBlocked = false;
  try { await propositionAction('libramont', { action: 'publiee', id: 5 }, { query: guardQuery }); } catch (e) { republishBlocked = e.statusCode === 409; }
  ok(republishBlocked, 'republier une carte déjà traitée → 409 (aucun verdict écrasé, findings 6 & 9)');
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
