// « Le Brief » — l'agrégateur unique de la page Marketing (refonte 2026-07-17).
//
// La page ne parle plus jamais aux moteurs : UN GET renvoie tout le mémo du
// matin — la paie (euros liés aux publications), le brief signé (2-4 phrases à
// la première personne), le radar 14 jours, la file de Propositions unifiée,
// les reçus (mesures J+14) et le résumé de veille.
//
// UNIFICATION : les trois producteurs (idées du cron matinal, plan daté du
// cerveau, demandes du gérant) convergent vers UN objet Proposition :
//   { key, id?, trigger, why, dueDate, kind, pinned, network, networks{},
//     photoIdea, imagePrompt, bestSlot, status }
// Le plan du cerveau est VOLATIL (recalculé) ; il ne se persiste qu'au moment
// d'une action (publier/refuser/adapter) — dédupe par signature. En collision
// (même jour cible + même déclencheur), le plan daté gagne sur l'idée du cron.
//
// INTÉGRITÉ DE LA MESURE : le statut « publiée » n'est posé QUE par le bandeau
// « Publié ? → Oui » (applied_at = date de publication → mesure J+14 par
// measureAppliedInsights). Copier ne publie jamais.
const { getPool } = require('./database');
const { buildMarketingBrain } = require('./marketing-brain');
const { computeMarketingRoi } = require('./marketing-roi');
const { listMarketingInsights, listDailyMetrics } = require('./center-metrics');
const { generateContentPack } = require('./content-studio');
const { llmProvider, callLlmJson } = require('./llm-client');

const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MAX_ACTIVE_PROPOSITIONS = 6;

// Réseaux visibles par tenant (spec : TikTok/LinkedIn masqués pour Fun Galaxy,
// réversible pour un futur client). 'story' est rendu par content-studio
// (champ story du pack Instagram).
const TENANT_NETWORKS = { default: ['facebook', 'instagram', 'story'] };

function tenantNetworks(centerId) {
  return TENANT_NETWORKS[centerId] || TENANT_NETWORKS.default;
}

function frDay(dateStr) {
  return `${DAY_LABELS_FR[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function frLongDate(dateStr) {
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${DAY_LABELS_FR[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

// ── Triggers (vocabulaire UNIQUE de la page) ─────────────────────────────────

const TRIGGER_LABELS = {
  pluie: 'pluie', chaleur: 'chaleur', creux: 'jour calme', jour_fort: 'jour fort',
  evenement: 'événement', vacances: 'vacances', concurrent: 'concurrence',
  demande: 'ta demande', plan: 'mon plan',
};

function triggerFromSignature(signature = '') {
  const head = String(signature).split(':')[0];
  return {
    rain_forecast: 'pluie', heat_forecast: 'chaleur', local_event: 'evenement',
    school_holiday: 'vacances', quiet_day: 'creux',
  }[head] || 'plan';
}

function triggerFromPlanType(type = '') {
  return { social_push: 'creux', email_push: 'creux', structural_offer: 'creux', harvest: 'jour_fort' }[type] || 'plan';
}

// ── Propositions : normalisation des trois producteurs ──────────────────────

function propositionFromInsight(insight) {
  const payload = insight.payload || {};
  const channel = insight.channel || '';
  const kind = channel === 'email' ? 'email' : (payload.kind === 'offre' ? 'offre' : 'post');
  const defaultNet = kind === 'email' ? 'email' : (['facebook', 'instagram', 'story'].includes(channel) ? channel : 'facebook');
  return {
    key: `db:${insight.id}`,
    // Une proposition née d'une action du gérant (demande, plan persisté) est
    // déjà arbitrée ; une idée du cron reste challengeable par le plan daté.
    source: insight.kind === 'proposition' || insight.kind === 'plan_action' ? 'persisted' : 'cron',
    id: Number(insight.id),
    trigger: payload.trigger || triggerFromSignature(insight.signature),
    why: insight.title && insight.body ? `${insight.title} — ${insight.body}` : (insight.body || insight.title || ''),
    whyShort: insight.title || insight.body || '',
    dueDate: insight.due_date || null,
    // Le jour VISÉ (targetDate) est restauré du payload : sans lui, une carte du
    // plan persistée (variante) et sa jumelle volatile avaient des clés de
    // collision différentes → carte dupliquée (finding 4).
    targetDate: payload.targetDate || null,
    kind,
    pinned: false,
    network: payload.network || defaultNet,
    networks: payload.networks || (insight.ready_content ? { [defaultNet]: { text: insight.ready_content } } : {}),
    photoIdea: payload.photoIdea || '',
    imagePrompt: payload.imagePrompt || '',
    bestSlot: payload.bestSlot || '',
    status: insight.status,
    signature: insight.signature || '',
  };
}

function propositionFromPlanAction(action) {
  const kind = action.channel === 'email'
    ? 'email'
    : (action.type === 'harvest' || action.type === 'structural_offer' ? 'offre' : 'post');
  // Un post garde SON réseau (social_push du cerveau = Instagram, pas Facebook).
  // Une « offre »/récolte est un rappel interne : aucun réseau publiable.
  const network = kind === 'email'
    ? 'email'
    : (['facebook', 'instagram'].includes(action.channel) ? action.channel : (kind === 'offre' ? 'interne' : 'facebook'));
  return {
    key: `plan:${action.id}`,
    id: null,
    trigger: triggerFromPlanType(action.type),
    why: action.why,
    whyShort: action.title,
    dueDate: action.executeOn,
    targetDate: action.targetDate,
    kind,
    pinned: false,
    network,
    networks: action.readyContent ? { [network]: { text: action.readyContent } } : {},
    photoIdea: '',
    imagePrompt: '',
    bestSlot: '',
    status: 'proposed',
    signature: `plan:${action.id}`,
  };
}

function propositionFromDailyPost(instagram, today) {
  return {
    key: 'daily',
    id: null,
    trigger: { rain: 'pluie', heat: 'chaleur', fill_gap: 'creux', local_event: 'evenement', school_holiday: 'vacances', editorial: 'plan' }[instagram.themeId] || 'plan',
    why: instagram.reason,
    whyShort: instagram.reason,
    dueDate: today,
    kind: 'post',
    pinned: true,
    network: 'instagram',
    networks: { instagram: { text: `${instagram.caption}\n\n${(instagram.hashtags || []).join(' ')}` } },
    photoIdea: String(instagram.visualBrief || '').replace(/^à filmer[^:]*:\s*/i, ''),
    imagePrompt: '',
    bestSlot: instagram.bestTime || '',
    status: 'proposed',
    signature: `daily:${today}:${instagram.themeId}`,
  };
}

// Fusion + dédoublonnage. Clé de slot : jour cible + déclencheur.
// Règles (spec + revue adversariale) :
//  - les lignes PERSISTÉES par le gérant (source 'persisted') sont TOUJOURS
//    gardées (id unique) et ne se dédupent jamais entre elles — deux demandes
//    libres cohabitent (finding 2) ;
//  - un slot DATÉ est arbitré par priorité : gérant (4) > plan (3) > cron (2) ;
//  - une action du plan (volatile) déjà persistée (variante) ou déjà actionnée
//    (publiée/refusée) est ÉCARTÉE — plus de doublon ni de résurrection
//    (findings 1 & 4) ;
//  - le post du jour, s'il a été enrichi (persisté), est épinglé tel quel au
//    lieu d'être écrasé par sa version volatile (finding 3) ; s'il a été
//    actionné aujourd'hui, il ne réapparaît pas (finding 1).
function mergePropositions({ fromDb = [], fromPlan = [], daily = null, actionedSignatures = new Set() } = {}) {
  const slotKey = (p) => `${p.targetDate || p.dueDate || 'sans-date'}|${p.trigger}`;
  const persistedSignatures = new Set(fromDb.map((p) => p.signature).filter(Boolean));
  const kept = [];
  const slotOwner = new Map(); // slot daté -> { index, priority }

  const claim = (p, priority) => {
    const dated = Boolean(p.targetDate || p.dueDate);
    if (dated) {
      const key = slotKey(p);
      const owner = slotOwner.get(key);
      if (owner) {
        if (owner.priority >= priority) return; // l'occupant gagne
        kept[owner.index] = null;               // remplacé par plus prioritaire
      }
      const index = kept.push(p) - 1;
      slotOwner.set(key, { index, priority });
      return;
    }
    kept.push(p); // sans date : jamais en conflit (finding 2)
  };

  // 1. Lignes du gérant : gardées d'office, priorité 4, réservent leur slot daté.
  for (const p of fromDb) {
    if (p.source !== 'persisted') continue;
    const dated = Boolean(p.targetDate || p.dueDate);
    const index = kept.push(p) - 1;
    if (dated) slotOwner.set(slotKey(p), { index, priority: 4 });
  }
  // 2. Idées du cron : priorité 2.
  for (const p of fromDb) if (p.source !== 'persisted') claim(p, 2);
  // 3. Actions du plan (volatiles) : priorité 3, écartées si déjà persistées ou actionnées.
  for (const p of fromPlan) {
    if (persistedSignatures.has(p.signature) || actionedSignatures.has(p.signature)) continue;
    claim(p, 3);
  }

  let merged = kept.filter(Boolean).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  if (daily) {
    if (persistedSignatures.has(daily.signature)) {
      const idx = merged.findIndex((p) => p.signature === daily.signature);
      if (idx >= 0) { const [row] = merged.splice(idx, 1); row.pinned = true; merged.unshift(row); }
    } else if (!actionedSignatures.has(daily.signature)) {
      // Le post du jour absorbe les idées AUTO (cron/plan) du même slot ET, pour
      // un sujet non daté (météo/événement/vacances), de même déclencheur — sinon
      // la Foire apparaissait deux fois (post du jour + idée cron). Les triggers
      // datés (creux/jour_fort) restent intacts : ce sont des jours différents.
      const key = slotKey(daily);
      const TOPICAL = new Set(['pluie', 'chaleur', 'evenement', 'vacances']);
      merged = merged.filter((p) => p.source === 'persisted'
        || (slotKey(p) !== key && !(TOPICAL.has(daily.trigger) && p.trigger === daily.trigger)));
      merged.unshift(daily);
    }
    // actionnée aujourd'hui → ne réapparaît pas.
  }
  return merged.slice(0, MAX_ACTIVE_PROPOSITIONS);
}

// ── Le brief signé (2-4 phrases, première personne) ──────────────────────────

// Assemblage DÉTERMINISTE des phrases depuis les faits (fallback complet),
// puis lissage IA optionnel avec grounding dur. `dataYoung` (historique < 60 j)
// interdit toute comparaison à une moyenne : on ne parle QUE de faits sûrs
// (événement, météo prévue, réservations déjà posées) — jamais de « +X % ».
function composeBriefText({ outlook = [], propositions = [], competitorsChanged = [], explainPast = [], dataYoung = false } = {}) {
  const cap = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  const sentences = [];

  // 1. Ce que j'ai vu — le signal le plus fort des 14 prochains jours.
  const event = outlook.map((d) => (d.drivers || []).find((x) => x.includes('à 5 min'))).find(Boolean);
  const weak = outlook.filter((day) => day.level === 'creux' || day.level === 'calme');
  const strong = outlook.filter((day) => day.level === 'fort');
  const nearHeat = outlook.slice(0, 7).find((d) => d.tmax !== null && d.tmax !== undefined && d.tmax >= 25);
  const nearRain = outlook.slice(0, 7).find((d) => d.precipMm !== null && d.precipMm >= 8);
  const bigBooked = [...outlook].filter((d) => d.booked && d.booked.pax >= 15).sort((a, b) => b.booked.pax - a.booked.pax)[0];

  if (event) {
    sentences.push(`${cap(event.replace(' (à 5 min)', ''))} arrive à 5 minutes — c'est le moment de te montrer.`);
  } else if (!dataYoung && weak.length) {
    const first = weak[0];
    sentences.push(`${cap(frDay(first.date))} s'annonce ${first.level === 'creux' ? 'très calme' : 'calme'}${first.drivers && first.drivers.length ? ` — ${first.drivers[0]}` : ''}.`);
  } else if (!dataYoung && strong.length && strong[0].booked && strong[0].booked.pax) {
    sentences.push(`${cap(frDay(strong[0].date))} s'annonce fort : ${strong[0].booked.pax} personnes ont déjà réservé.`);
  } else if (nearRain) {
    sentences.push(`De la pluie ${frDay(nearRain.date)} — c'est tout bon pour l'indoor, j'ai préparé de quoi en profiter.`);
  } else if (nearHeat) {
    sentences.push(`Il va faire chaud cette semaine (jusqu'à ${Math.round(Math.max(...outlook.slice(0, 7).filter((d) => d.tmax != null).map((d) => d.tmax)))}°) — de quoi donner envie de sortir.`);
  } else if (!dataYoung && explainPast.length) {
    sentences.push(explainPast[0].summary);
  } else if (bigBooked) {
    sentences.push(`${cap(frDay(bigBooked.date))} se remplit déjà : ${bigBooked.booked.pax} réservations posées.`);
  } else {
    sentences.push('Semaine tranquille côté météo — rien d\'urgent, je garde un œil sur tes réservations.');
  }

  // 2. Ce que j'ai préparé.
  const posts = propositions.filter((p) => p.kind === 'post').length;
  const emails = propositions.filter((p) => p.kind === 'email').length;
  if (posts || emails) {
    const parts = [];
    if (posts) parts.push(posts === 1 ? 'un post' : `${posts} posts`);
    if (emails) parts.push(emails === 1 ? 'un email' : `${emails} emails`);
    sentences.push(`Je t'ai préparé ${parts.join(' et ')} — tout est prêt plus bas.`);
  }

  // 3. La veille.
  if (competitorsChanged.length) {
    sentences.push(`Du mouvement chez ${competitorsChanged[0].name} cette nuit — détail en bas de page.`);
  }

  if (sentences.length === 1 && !posts && !emails && !competitorsChanged.length) {
    return 'Rien à signaler aujourd\'hui — les 14 prochains jours tiennent la route. Je repasse demain à l\'aube.';
  }
  return sentences.slice(0, 4).join(' ');
}

const briefPolishCache = new Map();
async function polishBriefText(text, centerId, today) {
  if (!llmProvider()) return null;
  // Clé = le texte BRUT entier (pas sa longueur) : deux briefs de même longueur
  // mais de faits différents (« pluie mardi » → « pluie jeudi ») ne doivent
  // jamais se partager un cache (finding 7).
  const cacheKey = `${centerId}|${today}|${text}`;
  if (briefPolishCache.has(cacheKey)) return briefPolishCache.get(cacheKey);
  const result = await callLlmJson({
    stableSystem: [
      'Tu es l\'employé marketing d\'un centre de loisirs. Tu réécris ton brief du matin au gérant : même contenu, plus naturel et direct, à la première personne, en tutoyant.',
      'RÈGLE ABSOLUE : tu ne changes AUCUN fait, tu n\'ajoutes AUCUN chiffre, AUCUNE date, AUCUN nom qui ne figure pas dans le texte fourni. 2 à 4 phrases maximum. Zéro jargon.',
      'Réponds uniquement en JSON conforme au schéma.',
    ].join(' '),
    user: JSON.stringify({ brief: text }),
    schema: { type: 'object', additionalProperties: false, properties: { texte: { type: 'string' } }, required: ['texte'] },
    schemaName: 'brief_polish',
    maxTokens: 300,
    timeoutMs: 8000,
  }).catch(() => null);
  const polished = result && typeof result.texte === 'string' ? result.texte.trim() : '';
  if (!polished || polished.length < 20 || polished.length > 600) return null;
  const allowed = new Set(text.match(/\d+(?:[.,]\d+)?/g) || []);
  if ((polished.match(/\d+(?:[.,]\d+)?/g) || []).some((n) => !allowed.has(n))) return null;
  briefPolishCache.set(cacheKey, polished);
  if (briefPolishCache.size > 30) briefPolishCache.delete(briefPolishCache.keys().next().value);
  return polished;
}

// ── Le radar : phrase d'explication par jour ─────────────────────────────────

function dayExplanation(day) {
  const parts = [];
  const label = frDay(day.date);
  const levelWord = { creux: 'très calme attendu', calme: 'calme attendu', fort: 'belle journée attendue', normal: 'journée normale attendue' }[day.level] || 'journée normale attendue';
  parts.push(`${label.charAt(0).toUpperCase()}${label.slice(1)} : ${levelWord}`);
  const driver = (day.drivers || []).find((d) => !d.startsWith('déjà'));
  if (driver) parts.push(driver);
  const sentence = `${parts.join(' — ')}.`;
  const resa = day.booked && day.booked.pax ? ` ${day.booked.pax} résa${day.booked.pax > 1 ? 's' : ''} déjà posée${day.booked.pax > 1 ? 's' : ''}.` : '';
  return sentence + resa;
}

// ── Les reçus (mesures J+14, format ticket) ──────────────────────────────────

function receiptFromInsight(insight) {
  const when = insight.applied_at ? String(insight.applied_at).slice(0, 10) : null;
  const label = `${insight.title || 'Publication'}${when ? ` du ${when.slice(8, 10)}/${when.slice(5, 7)}` : ''}`;
  if (['validated', 'refuted', 'inconclusive'].includes(insight.status)) {
    const r = insight.result || {};
    const delta = r.deltaPct === null || r.deltaPct === undefined ? null : Math.round(Number(r.deltaPct));
    return {
      id: Number(insight.id),
      label,
      tone: insight.status === 'validated' ? 'good' : 'neutral',
      // Honnêteté : la mesure J+14 est en % de fréquentation à jours
      // comparables — pas de faux euros par action.
      result: insight.status === 'validated' && delta !== null
        ? `+${delta} % de monde`
        : (insight.status === 'refuted' || delta === null ? 'pas d\'effet mesurable' : `${delta > 0 ? '+' : ''}${delta} % — pas assez net`),
      redoable: insight.status === 'validated',
    };
  }
  const verdictDate = insight.applied_at ? new Date(new Date(insight.applied_at).getTime() + 14 * 864e5).toISOString().slice(0, 10) : null;
  return {
    id: Number(insight.id),
    label,
    tone: 'pending',
    result: verdictDate ? `verdict le ${frLongDate(verdictDate).replace(/^\S+\s/, '')}` : 'mesure en cours',
    redoable: false,
  };
}

// ── LE bundle ────────────────────────────────────────────────────────────────

async function buildMarketingBriefBundle(centerId = 'libramont', { days = 30, today = null } = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const brainBuilder = deps.buildMarketingBrain || buildMarketingBrain;
  const roiBuilder = deps.computeMarketingRoi || computeMarketingRoi;
  const insightsLister = deps.listMarketingInsights || listMarketingInsights;

  const [brain, roi, allInsights, competitorsResult] = await Promise.all([
    brainBuilder(centerId, { today }),
    roiBuilder(centerId, { days: Number(days) || 30 }),
    insightsLister(centerId, { limit: 120 }),
    query(
      `select c.name, s.diff_summary, s.fetched_at
       from marketing_competitors c
       join competitor_snapshots s on s.competitor_id = c.id
       where c.center_id = $1 and s.fetched_at > now() - interval '36 hours' and s.diff_summary <> ''
         and s.diff_summary not like 'Première capture%'
       order by s.fetched_at desc limit 3;`,
      [centerId],
    ).catch(() => ({ rows: [] })),
  ]);
  const competitorCount = await query(
    'select count(*)::int as count from marketing_competitors where center_id = $1 and enabled = true;',
    [centerId],
  ).catch(() => ({ rows: [{ count: 0 }] }));

  const todayStr = brain.today;
  const active = allInsights.filter((insight) => insight.status === 'proposed').slice(0, 8);
  const measured = allInsights.filter((insight) => ['applied', 'validated', 'refuted', 'inconclusive'].includes(insight.status)).slice(0, 30);
  const competitorsChanged = competitorsResult.rows.map((row) => ({ name: row.name, diff: row.diff_summary }));
  // Signatures déjà actionnées (publiée/refusée/mesurée) : une volatile qui les
  // porte ne doit JAMAIS réapparaître dans la file (findings 1 & 4).
  const actionedSignatures = new Set(
    allInsights.filter((insight) => insight.status !== 'proposed').map((insight) => insight.signature).filter(Boolean),
  );

  const propositions = mergePropositions({
    fromDb: active.map(propositionFromInsight),
    fromPlan: (brain.plan || []).map(propositionFromPlanAction),
    daily: brain.instagram ? propositionFromDailyPost(brain.instagram, todayStr) : null,
    actionedSignatures,
  });

  // Le radar pointe vers la proposition qui vise chaque jour.
  const propositionByDate = new Map();
  for (const p of propositions) {
    const target = p.targetDate || p.dueDate;
    if (target && !propositionByDate.has(target)) propositionByDate.set(target, p.key);
  }

  const radar = (brain.outlook || []).map((day) => ({
    date: day.date,
    dow: day.dow,
    level: day.level,
    tmax: day.tmax,
    precipMm: day.precipMm,
    event: (day.drivers || []).find((d) => d.includes('à 5 min')) || '',
    resaCount: day.booked ? day.booked.pax : 0,
    explanation: dayExplanation(day),
    propositionKey: propositionByDate.get(day.date) || null,
  }));

  const rawBrief = composeBriefText({ outlook: brain.outlook, propositions, competitorsChanged, explainPast: brain.explainPast, dataYoung: (brain.dataDays || 0) < 60 });
  const polished = deps.skipPolish ? null : await polishBriefText(rawBrief, centerId, todayStr);

  // Le POULS business : vrais chiffres du centre (30 j passés + 14 j à venir).
  // La page Marketing n'est jamais « vide » — même sans campagne, elle montre
  // l'activité réelle qui donne le contexte de tout le reste.
  const metricsLister = deps.listDailyMetrics || listDailyMetrics;
  const past30 = await metricsLister(centerId, addDaysIso(todayStr, -30), addDaysIso(todayStr, -1)).catch(() => ({ totals: { visitors: 0, revenue: 0 }, bestDay: null, rows: [] }));
  const upcomingPax = (brain.outlook || []).reduce((sum, d) => sum + (d.booked ? d.booked.pax : 0), 0);
  const upcomingResa = (brain.outlook || []).reduce((sum, d) => sum + (d.booked ? d.booked.reservations : 0), 0);
  const reservedRevenue = (brain.outlook || []).reduce((sum, d) => sum + (d.booked ? (d.booked.revenue || 0) : 0), 0);
  const pastVisitors = Number(past30.totals?.visitors || 0);
  const pastRevenue = Number(past30.totals?.revenue || 0);
  const pulse = {
    revenue30: Math.round(pastRevenue),
    visitors30: pastVisitors,
    avgBasket: pastVisitors > 0 ? Math.round((pastRevenue / pastVisitors) * 10) / 10 : 0,
    upcomingPax,
    upcomingResa,
    reservedRevenue: Math.round(reservedRevenue),
    bestDay: past30.bestDay ? { date: past30.bestDay.date, revenue: Math.round(Number(past30.bestDay.revenue_total || 0)), visitors: Number(past30.bestDay.visitors || 0) } : null,
  };

  return {
    ok: true,
    centerId,
    today: todayStr,
    generatedAt: new Date().toISOString(),
    networks: tenantNetworks(centerId),
    paie: {
      euros: roi.revenue,
      venues: roi.conversions,
      sent: roi.sent,
      reviewClicks: roi.reviewClicks,
      days: roi.days,
      sources: (roi.bySource || []).filter((s) => s.sent > 0).sort((a, b) => b.revenue - a.revenue),
      // Compte jeune : pas d'envois → premier bilan = J+14 après aujourd'hui.
      young: roi.sent === 0,
      firstVerdictDate: frLongDate(new Date(new Date(`${todayStr}T12:00:00Z`).getTime() + 14 * 864e5).toISOString().slice(0, 10)),
    },
    brief: {
      text: polished || rawBrief,
      // Dégradé = pas de clé IA (les faits restent exacts, les phrases template).
      degraded: !(deps.llmProvider || llmProvider)(),
    },
    pulse,
    radar,
    dataDays: brain.dataDays,
    medianVisitors: brain.medianVisitors,
    propositions,
    receipts: measured.map(receiptFromInsight),
    veille: {
      count: Number(competitorCount.rows[0]?.count || 0),
      changed: competitorsChanged,
    },
  };
}

// ── Actions sur une proposition ──────────────────────────────────────────────

// Persiste une proposition volatile (plan/daily) au moment de la première
// action — dédupe par signature (7 j), même mécanique que le plan d'avant.
async function ensurePersisted(centerId, proposition, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  if (proposition.id) return Number(proposition.id);
  const signature = String(proposition.signature || `prop:${proposition.trigger}:${proposition.dueDate || 'sans-date'}`).slice(0, 120);
  const network = proposition.network || 'facebook';
  const text = proposition.networks && proposition.networks[network] ? proposition.networks[network].text : '';
  // INSERT conditionnel en UNE requête (WHERE NOT EXISTS évalué à l'insert) :
  // resserre la fenêtre de course du select-puis-insert (finding 5). Combiné à
  // la sérialisation front (mkBrief.busy) et à la garde status côté publiée,
  // deux mesures J+14 de la même action deviennent hors d'atteinte en usage réel.
  const inserted = await query(
    `insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature, payload, due_date)
     select $1, 'proposition', $2, $3, $4, $5, '[]'::jsonb, $6, $7::jsonb, $8
     where not exists (
       select 1 from marketing_insights
       where center_id = $1 and signature = $6 and proposed_at > now() - interval '7 days'
     )
     returning id;`,
    [
      centerId,
      String(proposition.whyShort || 'Proposition').slice(0, 200),
      String(proposition.why || '').slice(0, 1000),
      proposition.kind === 'email' ? 'email' : network,
      String(text || '').slice(0, 4000),
      signature,
      JSON.stringify({
        trigger: proposition.trigger,
        kind: proposition.kind || 'post',
        network,
        networks: proposition.networks || {},
        // targetDate conservé : la clé de collision au round-trip reste stable
        // (finding 4).
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(String(proposition.targetDate || '')) ? proposition.targetDate : null,
        photoIdea: proposition.photoIdea || '',
        imagePrompt: proposition.imagePrompt || '',
        bestSlot: proposition.bestSlot || '',
      }),
      /^\d{4}-\d{2}-\d{2}$/.test(String(proposition.dueDate || '')) ? proposition.dueDate : null,
    ],
  );
  if (inserted.rows[0]) return Number(inserted.rows[0].id);
  // La ligne existait déjà (course perdue ou re-persistance) → on récupère son id.
  const existing = await query(
    `select id from marketing_insights
     where center_id = $1 and signature = $2 and proposed_at > now() - interval '7 days'
     order by id desc limit 1;`,
    [centerId, signature],
  );
  if (!existing.rows[0]) throw httpError('Impossible d\'enregistrer la proposition.', 500);
  return Number(existing.rows[0].id);
}

async function propositionAction(centerId, { action, id = null, proposition = null, network = '', angle = '' } = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const allowed = ['publiee', 'refusee', 'variante', 'autre_angle'];
  if (!allowed.includes(action)) throw httpError('Action inconnue.');
  const insightId = id ? Number(id) : await ensurePersisted(centerId, proposition || {}, deps);
  if (!Number.isFinite(insightId)) throw httpError('Proposition introuvable.', 404);

  if (action === 'publiee') {
    // SEULE porte vers le statut publié : ouvre la fenêtre de mesure J+14.
    // Garde `status = 'proposed'` : republier une carte déjà applied/validée
    // n'écrase JAMAIS applied_at ni un verdict rendu (finding 6). Le RETURNING
    // + rowCount détecte l'id périmé ou d'un autre centre (finding 9).
    const res = await query(
      `update marketing_insights set status = 'applied', applied_at = now()
       where id = $1 and center_id = $2 and status = 'proposed'
       returning id;`,
      [insightId, centerId],
    );
    if (!res.rows[0]) throw httpError('Cette proposition n\'est plus publiable (déjà traitée).', 409);
    return { ok: true, id: insightId, status: 'publiee' };
  }
  if (action === 'refusee') {
    // Refus possible uniquement tant que la carte est proposée (une carte déjà
    // publiée/mesurée n'est pas rétractable — sa mesure court). L'UI ignore un
    // 409 (la carte est déjà masquée côté client).
    const res = await query(
      `update marketing_insights set status = 'ignored'
       where id = $1 and center_id = $2 and status = 'proposed'
       returning id;`,
      [insightId, centerId],
    );
    if (!res.rows[0]) throw httpError('Cette proposition n\'est plus refusable.', 409);
    return { ok: true, id: insightId, status: 'refusee' };
  }

  // variante réseau / autre angle → LA PLUME (content-studio, boucle qualité
  // silencieuse), puis mise à jour du payload.
  const wanted = ['facebook', 'instagram', 'story'].includes(network) ? network : 'facebook';
  const studioPlatform = wanted === 'story' ? 'instagram' : wanted;
  const generator = deps.generateContentPack || generateContentPack;
  const pack = await generator(centerId, { platform: studioPlatform, brief: String(angle || '').slice(0, 300) });
  const text = wanted === 'story' ? pack.story : `${pack.long}\n\n${(pack.hashtags || []).join(' ')}`;
  const entry = { text, photoIdea: pack.photoIdea || '', imagePrompt: pack.aiImagePrompt || '', bestSlot: pack.bestTime || '' };
  await query(
    `update marketing_insights
     set payload = payload || jsonb_build_object('networks', coalesce(payload->'networks', '{}'::jsonb) || $3::jsonb, 'network', $4::text),
         ready_content = $5
     where id = $1 and center_id = $2;`,
    [insightId, centerId, JSON.stringify({ [wanted]: entry }), wanted, String(text).slice(0, 4000)],
  );
  return { ok: true, id: insightId, network: wanted, entry };
}

// Création à la demande : barre « Demander », chips, radar « Prépare-moi un
// post pour remplir ce jour ».
async function createProposition(centerId, { brief = '', targetDate = null, trigger = 'demande' } = {}, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const cleanBrief = String(brief || '').trim().slice(0, 300);
  const safeTrigger = ['demande', 'creux'].includes(trigger) ? trigger : 'demande';
  // La date est validée AVANT la garde : un targetDate mal formé ne franchit
  // plus la garde avec un brief vide (finding 10) — pas de carte poubelle ni
  // d'appel LLM sur une demande sans objet.
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || '')) ? targetDate : null;
  if (!cleanBrief && !dueDate) throw httpError('Dis-moi ce que tu veux, même en trois mots.');
  const generator = deps.generateContentPack || generateContentPack;
  const pack = await generator(centerId, { platform: 'facebook', brief: cleanBrief });
  const why = safeTrigger === 'creux' && dueDate
    ? `Tu m'as demandé de remplir ${frDay(dueDate)} — voilà ce que je posterais.`
    : `Tu m'as demandé : « ${cleanBrief} » — voilà ce que je posterais.`;
  const text = `${pack.long}\n\n${(pack.hashtags || []).join(' ')}`;
  const inserted = await query(
    `insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature, payload, due_date)
     values ($1, 'proposition', $2, '', 'facebook', $3, '[]'::jsonb, $4, $5::jsonb, $6)
     returning id;`,
    [
      centerId,
      why.slice(0, 200),
      text.slice(0, 4000),
      `demande:${Date.now()}`,
      JSON.stringify({ trigger: safeTrigger, network: 'facebook', networks: { facebook: { text, photoIdea: pack.photoIdea || '', imagePrompt: pack.aiImagePrompt || '', bestSlot: pack.bestTime || '' } }, photoIdea: pack.photoIdea || '', imagePrompt: pack.aiImagePrompt || '', bestSlot: pack.bestTime || '' }),
      dueDate,
    ],
  );
  return { ok: true, id: Number(inserted.rows[0].id) };
}

module.exports = {
  buildMarketingBriefBundle,
  propositionAction,
  createProposition,
  // Purs / testables
  mergePropositions,
  composeBriefText,
  dayExplanation,
  receiptFromInsight,
  propositionFromInsight,
  propositionFromPlanAction,
  propositionFromDailyPost,
  triggerFromSignature,
  tenantNetworks,
  TRIGGER_LABELS,
};
