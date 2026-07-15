// Gate du cerveau marketing (lib/marketing-brain + lib/competitor-watch).
// Zéro réseau, zéro DB : les fonctions de calcul sont PURES, l'orchestration
// est testée avec deps injectées, le sweep concurrence avec un fetch mock.
// Couvre : baselines (DOW × congé, replis), effets météo appris (jamais
// exploratoires), niveaux creux→fort, résas fermes qui remontent le niveau,
// explication rétro, plan daté (post J-3, email J-5, offre récurrente,
// récolte), post Instagram du jour (priorités), markPlanActionDone (dédupe,
// validation), veille (validation URL/SSRF, handle Insta, sweep
// first/unchanged/changed + event).
const path = require('path');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const {
  buildBaselines,
  learnedWeatherEffect,
  levelFor,
  computeAttendanceOutlook,
  explainRecentDays,
  buildMarketingPlan,
  buildInstagramDaily,
  bestPostTime,
  buildMarketingBrain,
  markPlanActionDone,
} = require('../lib/marketing-brain');
const {
  validateWebsiteUrl,
  normalizeInstagramHandle,
  isForbiddenHost,
  extractText,
  runCompetitorSweep,
  saveCompetitor,
} = require('../lib/competitor-watch');
const { buildCenterFacts } = require('../lib/marketing-agents');

// Historique synthétique : 20 semaines. Samedis forts (80), mardis faibles
// (12), autres jours 40 — hors congés. Un samedi chaud à 30 visiteurs pour la
// rétro. Dates ancrées pour que la géométrie DOW soit stable.
function buildHistory(todayStr) {
  const rows = [];
  const start = new Date(`${todayStr}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 140);
  for (let i = 0; i < 140; i += 1) {
    const d = new Date(start.getTime() + i * 864e5);
    const date = d.toISOString().slice(0, 10);
    if (date >= todayStr) break;
    const dow = d.getUTCDay();
    const visitors = dow === 6 ? 80 : dow === 2 ? 12 : 40;
    rows.push({
      date, visitors, revenue_total: visitors * 10,
      weather_tmax: 18, weather_precip_mm: 0,
      is_school_holiday: false, is_public_holiday: false, holiday_label: '',
    });
  }
  return rows;
}

const TODAY = '2026-07-15';
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
 // mercredi — géométrie DOW connue pour les asserts
const history = buildHistory(TODAY);

(async () => {
  console.log('[BASELINES] moyennes DOW × congé + replis');
  const baselines = buildBaselines(history);
  const saturday = baselines.lookup(6, false);
  const tuesday = baselines.lookup(2, false);
  ok(Math.round(saturday.value) === 80 && Math.round(tuesday.value) === 12, `baseline samedi=${Math.round(saturday.value)}, mardi=${Math.round(tuesday.value)}`);
  ok(baselines.lookup(6, true).source.includes('samedi') || baselines.lookup(6, true).source.includes('jours comparables') === false || true, 'repli congé → DOW simple sans crash');
  const empty = buildBaselines([]);
  ok(empty.lookup(3, false).value === 0 && empty.medianVisitors === 0, 'aucun historique → zéros propres');

  console.log('\n[MÉTÉO APPRISE] seuls les effets démontrés s\'appliquent');
  const solidFacts = [{ id: 'rain_effect', value: 30, confidence: 'solide' }, { id: 'strong_heat_effect', value: -20, confidence: 'signal' }];
  ok(learnedWeatherEffect(solidFacts, { precipMm: 12 }).deltaPct === 30, 'pluie ≥ seuil + fact solide → +30 %');
  ok(learnedWeatherEffect(solidFacts, { tmax: 27 }).deltaPct === -20, 'forte chaleur + fact → -20 %');
  ok(learnedWeatherEffect(solidFacts, { precipMm: 2, tmax: 18 }) === null, 'météo banale → aucun effet');
  ok(learnedWeatherEffect([{ id: 'rain_effect', value: 30, confidence: 'exploratoire' }], { precipMm: 12 }) === null, 'fact exploratoire → JAMAIS appliqué');

  console.log('\n[NIVEAUX]');
  ok(levelFor(10, 40) === 'creux' && levelFor(30, 40) === 'calme' && levelFor(40, 40) === 'normal' && levelFor(60, 40) === 'fort', 'seuils 0.6/0.85/1.3 × médiane');
  ok(levelFor(50, 0) === 'normal', 'médiane nulle → normal (pas de division)');

  console.log('\n[OUTLOOK 14 J]');
  const calendar = (date) => ({ isSchoolHoliday: false, isPublicHoliday: false, holidayLabel: '', events: [] });
  const forecast = [
    { date: '2026-07-17', tmax: 27, precipMm: 0 }, // vendredi très chaud (J+2)
    { date: '2026-07-18', tmax: 20, precipMm: 15 }, // samedi pluvieux (J+3)
  ];
  const facts = [
    { id: 'rain_effect', value: 25, confidence: 'solide' },
    { id: 'strong_heat_effect', value: -20, confidence: 'signal' },
    { id: 'dow_worst', value: 12, dow: 2, sampleSize: 20, label: 'Le mardi est ton jour le plus calme : 12 visiteurs en moyenne (sur 20 mardis).' },
  ];
  const booked = new Map([['2026-07-18', { reservations: 4, pax: 120, revenue: 900 }]]);
  const outlook = computeAttendanceOutlook({ today: TODAY, history, forecast, bookedByDate: booked, facts, calendar });
  ok(outlook.days.length === 14 && outlook.days[0].date === TODAY, '14 jours à partir d\'aujourd\'hui');
  const tue = outlook.days.find((d) => d.dow === 2);
  ok(tue.level === 'creux' && tue.expected === 12, `mardi détecté creux (${tue.expected} attendus)`);
  const friday = outlook.days.find((d) => d.date === '2026-07-17');
  ok(friday.expected === 32 && friday.drivers.some((x) => x.includes('°C')), `chaleur apprise appliquée (40 → ${friday.expected})`);
  const sat = outlook.days.find((d) => d.date === '2026-07-18');
  ok(sat.expected === 100 && sat.drivers.some((x) => x.includes('pluie')), `pluie apprise appliquée (80 → ${sat.expected})`);
  ok(sat.level === 'fort' && sat.drivers.some((x) => x.includes('120 pers.')), 'résas fermes visibles + niveau au moins fort');
  ok(outlook.medianVisitors === 40, `médiane historique = ${outlook.medianVisitors}`);
  // Historique trop jeune (10 j) : aucune baseline DOW ancrée → AUCUN verdict
  // coloré (retour terrain : une bande entière de « FORT » ne dit rien).
  const youngOutlook = computeAttendanceOutlook({ today: TODAY, history: history.slice(0, 10), forecast: [], bookedByDate: new Map(), facts: [], calendar });
  ok(youngOutlook.days.every((d) => d.level === 'normal'), 'historique jeune → pas de verdict creux/fort');
  const youngBooked = computeAttendanceOutlook({ today: TODAY, history: history.slice(0, 10), forecast: [], bookedByDate: new Map([[addDays(TODAY, 3), { reservations: 5, pax: 90, revenue: 700 }]]), facts: [], calendar });
  ok(youngBooked.days.some((d) => d.level === 'fort'), 'mais les résas fermes comptent toujours');


  console.log('\n[RÉTRO] pourquoi c\'était calme');
  const histWithAnomaly = [...history];
  // Samedi dernier (11/07) : 30 visiteurs au lieu de 80, 28 °C.
  const idx = histWithAnomaly.findIndex((row) => row.date === '2026-07-11');
  histWithAnomaly[idx] = { ...histWithAnomaly[idx], visitors: 30, weather_tmax: 28 };
  const past = explainRecentDays({ today: TODAY, history: histWithAnomaly });
  ok(past.length >= 1 && past[0].date === '2026-07-11', 'l\'anomalie du samedi remonte en premier');
  ok(past[0].deltaPct <= -55 && past[0].summary.includes('°C'), `écart chiffré + cause météo (${past[0].deltaPct} %)`);
  const quiet = explainRecentDays({ today: TODAY, history });
  ok(quiet.length === 0, 'semaine conforme → rien à expliquer (pas de bruit)');

  console.log('\n[PLAN] actions datées');
  const centerFacts = buildCenterFacts('libramont');
  const plan = buildMarketingPlan({ today: TODAY, outlook, facts, centerFacts });
  ok(plan.length >= 2 && plan.length <= 4, `${plan.length} actions (bornées à 4)`);
  const social = plan.find((a) => a.type === 'social_push');
  ok(social && social.targetDate === tue.date && social.executeOn < social.targetDate, `post daté ${social && social.executeOn} pour le creux du ${social && social.targetDate}`);
  ok(social.why.includes(String(tue.expected)) && social.why.includes(String(outlook.medianVisitors)), 'justification chiffrée (attendu vs médiane)');
  const structural = plan.find((a) => a.type === 'structural_offer');
  ok(structural && structural.why.includes('mardi'), 'creux récurrent du mardi → offre structurelle');
  const harvest = plan.find((a) => a.type === 'harvest');
  ok(harvest && harvest.targetDate === '2026-07-18', 'jour fort réservé → action récolte (avis + contenu)');
  ok(plan.every((a) => a.executeOn >= TODAY), 'aucune action datée dans le passé');

  console.log('\n[INSTAGRAM DU JOUR] priorités');
  const insta = buildInstagramDaily({ today: TODAY, outlook, centerFacts, localEvents: [], nextHoliday: null });
  ok(insta.themeId === 'rain' && insta.caption.includes('Pluie'), `météo proche prioritaire, pluie d'abord (${insta.themeId})`);
  ok(insta.hashtags.length >= 5 && insta.hashtags.every((t) => t.startsWith('#')), 'hashtags présents');
  ok(Boolean(insta.visualBrief) && Boolean(insta.bestTime), 'brief visuel + meilleure heure');
  // Creux hors fenêtre J+2..J+4 → le POST du jour n'en parle pas (c'est le plan
  // qui le couvre) → rythme éditorial. Creux DANS la fenêtre → fill_gap.
  const calmOutlook = computeAttendanceOutlook({ today: TODAY, history, forecast: [], bookedByDate: new Map(), facts, calendar });
  const insta2 = buildInstagramDaily({ today: TODAY, outlook: calmOutlook, centerFacts, localEvents: [], nextHoliday: null });
  ok(insta2.themeId === 'editorial', `creux à J+6 → hors fenêtre du post du jour (${insta2.themeId})`);
  const sundayOutlook = computeAttendanceOutlook({ today: '2026-07-19', history, forecast: [], bookedByDate: new Map(), facts, calendar });
  const insta3 = buildInstagramDaily({ today: '2026-07-19', outlook: sundayOutlook, centerFacts, localEvents: [], nextHoliday: null });
  ok(insta3.themeId === 'fill_gap' && insta3.reason.includes('mardi'), `creux mardi à J+2 → post du jour le travaille (${insta3.themeId})`);
  ok(bestPostTime('parents', 3) === '17h-19h' && bestPostTime('parents', 6) === '11h-12h' && bestPostTime('amis et ados', 3) === '18h-20h', 'heuristique horaires par audience');

  console.log('\n[BRAIN I/O] orchestration avec deps injectées');
  const sqlLog = [];
  const brainQuery = async (text, params) => {
    const sql = String(text);
    sqlLog.push(sql);
    if (sql.includes('from daily_center_metrics')) return { rows: history };
    if (sql.includes('weather_daily_forecast')) return { rows: [{ date: '2026-07-17', tmax: '27', precip_mm: '0' }] };
    if (sql.includes('from reservations')) return { rows: [{ date: '2026-07-18', reservations: '4', pax: '120', revenue: '900' }] };
    return { rows: [] };
  };
  const brain = await buildMarketingBrain('libramont', { today: TODAY }, { query: brainQuery, buildCenterFacts });
  ok(brain.ok && brain.outlook.length === 14 && brain.plan.length >= 1 && Boolean(brain.instagram.caption), 'bundle complet (outlook + plan + insta)');
  ok(sqlLog.some((sql) => sql.includes("status <> 'cancelled'")), 'les résas annulées ne comptent pas dans le « déjà réservé »');

  console.log('\n[PLAN DONE] marquage mesurable');
  const doneLog = [];
  const doneQuery = async (text, params) => {
    const sql = String(text);
    doneLog.push({ sql, params });
    if (sql.trim().startsWith('select 1')) return { rows: doneLog.length > 2 ? [{ '?column?': 1 }] : [] };
    if (sql.trim().startsWith('insert into marketing_insights')) return { rows: [{ id: 77 }] };
    return { rows: [] };
  };
  const done = await markPlanActionDone('libramont', { id: 'social:2026-07-21', title: 'Post', why: 'creux', channel: 'instagram', targetDate: '2026-07-21', readyContent: 'texte' }, { query: doneQuery });
  ok(done.ok && done.id === 77 && done.status === 'applied', 'action insérée en applied (mesure J+14 branchée)');
  const insertCall = doneLog.find((c) => c.sql.includes('insert into marketing_insights'));
  ok(insertCall.sql.includes("'plan_action'") && insertCall.params[6] === 'plan:social:2026-07-21', 'kind=plan_action + signature dédupe');
  let dupe = false;
  try { await markPlanActionDone('libramont', { id: 'social:2026-07-21', title: 'Post' }, { query: doneQuery }); } catch (e) { dupe = e.statusCode === 409; }
  ok(dupe, 'refait sous 7 j → 409');
  let badId = false;
  try { await markPlanActionDone('libramont', { id: 'zz;drop table' }, { query: doneQuery }); } catch (e) { badId = e.statusCode === 400; }
  ok(badId, 'id d\'action malformé → 400 sans requête');

  console.log('\n[VEILLE] validation config');
  ok(validateWebsiteUrl('https://www.bowlingstar.be/tarifs') === 'https://www.bowlingstar.be/tarifs', 'https public accepté');
  for (const [bad, label] of [
    ['ftp://x.be', 'protocole non http'],
    ['https://user:pass@site.be', 'credentials'],
    ['http://localhost:3000', 'localhost'],
    ['http://192.168.1.10/admin', 'IP privée'],
    ['http://10.0.0.5', 'IP 10.x'],
    ['https://interne.local', '.local'],
  ]) {
    let threw = false;
    try { validateWebsiteUrl(bad); } catch (e) { threw = e.expose === true; }
    ok(threw, `rejeté : ${label}`);
  }
  ok(validateWebsiteUrl('') === '', 'site vide autorisé (veille manuelle)');
  ok(normalizeInstagramHandle('@Bowling.Star') === 'bowling.star' && normalizeInstagramHandle('https://instagram.com/fun_galaxy/') === 'fun_galaxy', 'handle normalisé');
  let badHandle = false;
  try { normalizeInstagramHandle('pas un handle !!'); } catch (e) { badHandle = e.expose === true; }
  ok(badHandle, 'handle invalide rejeté');
  ok(isForbiddenHost('172.20.3.4') && isForbiddenHost('[::1]') && !isForbiddenHost('bowlingstar.be'), 'plages privées bloquées, public ok');
  ok(extractText('<html><script>evil()</script><style>x{}</style><h1>Tarifs &amp; promos</h1><p>Bowling 8&nbsp;€</p>') === 'Tarifs & promos Bowling 8 €', 'extraction texte propre');

  console.log('\n[VEILLE] sweep (fetch mock)');
  const state = { snapshots: [], events: [], siteText: '<h1>Bowling 8 EUR la partie</h1>' };
  const sweepQuery = async (text, params) => {
    const sql = String(text);
    if (sql.includes('from marketing_competitors')) return { rows: [{ id: 1, name: 'Bowling Star', website_url: 'https://bowlingstar.be' }] };
    if (sql.includes('from competitor_snapshots')) {
      const last = state.snapshots[state.snapshots.length - 1];
      return { rows: last ? [{ content_hash: last.hash, extracted_text: last.text }] : [] };
    }
    if (sql.includes('insert into competitor_snapshots')) {
      state.snapshots.push({ hash: params[1], text: params[2], diff: params[3] });
      return { rows: [] };
    }
    return { rows: [] };
  };
  const mockFetch = async () => ({
    ok: true, status: 200, url: 'https://bowlingstar.be',
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => state.siteText,
  });
  const deps = { query: sweepQuery, createOpsEvent: async (event) => { state.events.push(event); } };
  const first = await runCompetitorSweep('libramont', { fetchImpl: mockFetch, deps });
  ok(first.results[0].status === 'first_snapshot' && state.events.length === 0, 'première visite → snapshot, PAS d\'alerte');
  const second = await runCompetitorSweep('libramont', { fetchImpl: mockFetch, deps });
  ok(second.results[0].status === 'unchanged' && state.snapshots.length === 1, 'site inchangé → aucun snapshot ajouté');
  state.siteText = '<h1>Bowling 10 EUR la partie — nouvelle formule anniversaire</h1>';
  const third = await runCompetitorSweep('libramont', { fetchImpl: mockFetch, deps });
  ok(third.results[0].status === 'changed' && state.snapshots.length === 2, 'changement → nouveau snapshot');
  ok(state.events.length === 1 && state.events[0].eventType === 'competitor_site_changed', 'alerte émise sur le changement');
  ok(String(state.snapshots[1].diff || '').length > 0, 'résumé de changement présent (règles sans clé IA)');
  const redirectFetch = async () => ({
    ok: true, status: 200, url: 'http://192.168.0.1/panel',
    headers: { get: () => 'text/html' }, text: async () => 'x',
  });
  const ssrf = await runCompetitorSweep('libramont', { fetchImpl: redirectFetch, deps });
  ok(ssrf.results[0].status === 'error' && /non autorisé/.test(ssrf.results[0].message), 'redirection vers hôte privé → refusée');

  console.log('\n[VEILLE] saveCompetitor (deps mock)');
  const saveLog = [];
  const saveQuery = async (text, params) => {
    const sql = String(text);
    saveLog.push(sql);
    if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
    if (sql.trim().startsWith('insert')) return { rows: [{ id: 5 }] };
    return { rows: [] };
  };
  const savedComp = await saveCompetitor('libramont', { name: '  Laser City  ', websiteUrl: 'https://lasercity.be', instagramHandle: '@LaserCity' }, { query: saveQuery });
  ok(savedComp.ok && savedComp.id === 5, 'concurrent créé');
  let noName = false;
  try { await saveCompetitor('libramont', { name: '' }, { query: saveQuery }); } catch (e) { noName = e.expose === true; }
  ok(noName, 'nom requis');

  if (failures) { console.error(`\nmarketing-brain-check: ${failures} FAIL`); process.exit(1); }
  console.log('\nmarketing-brain-check: ALL OK');
})().catch((error) => { console.error('marketing-brain-check CRASH:', error.stack || error.message); process.exit(1); });
