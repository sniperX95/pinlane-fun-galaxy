// Studio de contenu — un PACK complet par réseau, raffiné en boucle.
//
// Pour chaque canal (Facebook, Instagram, TikTok, LinkedIn), le studio produit
// d'un coup : version longue, version courte, story, idée photo (brief de
// prise de vue réelle pour le staff), prompt d'image IA (anglais, pour un
// générateur), hashtags et meilleure heure — ancrés sur l'angle du jour
// (météo prévue, événement local, vacances, occasion de saison).
//
// BOUCLE DE RAFFINEMENT : chaque version est notée par le scoring produit
// (scoreDraft — vérité centre, hook, CTA, garde-fous). Si la note est faible
// ou bloquée, un second appel repart avec les critères ratés convertis en
// instructions (CRITERION_FIX_HINTS) ; on garde la meilleure itération. Sans
// clé IA : pack déterministe (composeChannelDraft), jamais de page vide.
//
// Persistance : marketing_agent_runs (run_type 'content_pack') — le pack du
// jour se recharge sans repayer l'appel ; « Régénérer » force un nouveau run.
const { getPool } = require('./database');
const {
  buildCenterFacts,
  buildSignalPack,
  scoreDraft,
  CRITERION_FIX_HINTS,
} = require('./marketing-agents');
const { resolveOccasion, composeChannelDraft, pickSeasonalHook, getChannelSpec } = require('./fungalaxy-brand');
const { buildDataFactsBundle } = require('./center-metrics');
const { llmProvider, callLlmJson } = require('./llm-client');
const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
const { recommendAngle, angleByKey } = require('./marketing-bandit');

const STUDIO_CHANNELS = ['facebook', 'instagram', 'tiktok', 'linkedin'];
const MIN_ACCEPTED_SCORE = 82;
const MAX_ITERATIONS = 2;

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

// ── Angle du jour (déterministe, réutilise le bundle data) ──────────────────

function pickStudioTheme(bundle = {}, today) {
  const forecast = bundle.forecast7 || [];
  const rain = forecast.find((day) => day.precipMm !== null && day.precipMm >= 10);
  const heat = forecast.find((day) => day.tmax !== null && day.tmax >= 25);
  const event = (bundle.localEvents || [])[0] || null;
  const holiday = bundle.nextSchoolHoliday && bundle.nextSchoolHoliday.from >= today ? bundle.nextSchoolHoliday : null;
  if (rain) {
    return { id: 'rain', label: `Pluie prévue (${Math.round(rain.precipMm)} mm le ${rain.date.slice(8, 10)}/${rain.date.slice(5, 7)})`, occasionId: 'sortie_amis', facts: { precipMm: Math.round(rain.precipMm), date: rain.date } };
  }
  if (heat) {
    return { id: 'heat', label: `Chaleur prévue (${Math.round(heat.tmax)} °C le ${heat.date.slice(8, 10)}/${heat.date.slice(5, 7)})`, occasionId: 'sortie_amis', facts: { tmax: Math.round(heat.tmax), date: heat.date } };
  }
  if (event) {
    return { id: 'local_event', label: `${event.label} (du ${event.from.slice(8, 10)}/${event.from.slice(5, 7)} au ${event.to.slice(8, 10)}/${event.to.slice(5, 7)})`, occasionId: 'family_day', facts: { event: event.label, from: event.from, to: event.to } };
  }
  if (holiday) {
    return { id: 'school_holiday', label: `${holiday.label} (dès le ${holiday.from.slice(8, 10)}/${holiday.from.slice(5, 7)})`, occasionId: 'anniversaire_enfant', facts: { holiday: holiday.label, from: holiday.from } };
  }
  const season = pickSeasonalHook();
  return { id: 'seasonal', label: season.hook, occasionId: (season.focus || [])[0] || 'formules_decouverte', facts: {} };
}

// ── Pack déterministe (fallback sans clé, et squelette du prompt) ───────────

function shortVersionOf(longBody, cta) {
  const lines = String(longBody || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const hook = lines[0] || '';
  return [hook, cta ? `${cta}.` : ''].filter(Boolean).join('\n');
}

function buildRulesPack({ channel, centerFacts, occasion, theme }) {
  const composed = composeChannelDraft({ channel, facts: centerFacts, occasion, audience: occasion.audience });
  const activity = (centerFacts.activities || [])[0] || 'bowling';
  const city = centerFacts.city || '';
  return {
    long: composed.body,
    short: shortVersionOf(composed.body, composed.cta),
    story: `${occasion.emotionalHook || occasion.label}\n→ ${composed.cta || 'Réserve ta piste'}.`,
    photoIdea: `À shooter sur place : ${activity} en action, vraies personnes, lumière naturelle, format vertical. Un plan large + un plan serré sur les visages au moment fort.`,
    aiImagePrompt: `Candid photo inside a modern family entertainment center in ${city || 'Belgium'}, ${activity === 'bowling' ? 'bowling lanes with glowing pins' : activity}, group of friends laughing, warm neon accents, natural motion blur, shot on 35mm, photorealistic, no text, no logos`,
    hashtags: ['#bowling', '#lasergame', '#funGalaxy', `#${String(city).toLowerCase().replace(/[^a-z0-9]/g, '')}` , '#ardenne'].filter((tag) => tag.length > 1),
    bestTime: channel === 'linkedin' ? 'mardi-jeudi 8h-10h' : channel === 'tiktok' ? '18h-21h' : '17h-19h',
    generationMode: 'rules',
    theme: theme.label,
  };
}

// ── Génération IA avec boucle de raffinement ─────────────────────────────────

const PACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    long: { type: 'string' },
    short: { type: 'string' },
    story: { type: 'string' },
    photoIdea: { type: 'string' },
    aiImagePrompt: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    bestTime: { type: 'string' },
  },
  required: ['long', 'short', 'story', 'photoIdea', 'aiImagePrompt', 'hashtags', 'bestTime'],
};

function packFormatRules(channel) {
  const spec = getChannelSpec(channel) || {};
  return [
    `long : le post principal, prêt à publier (max ${spec.maxChars || 900} caractères), structure hook → corps → CTA.`,
    'short : version express — le hook + le CTA, 2-3 lignes max (pour repost rapide ou description courte).',
    channel === 'linkedin'
      ? 'story : une version « post sobre » alternative avec un angle différent (pas de story LinkedIn).'
      : 'story : texte d\'overlay pour une story verticale — 2 lignes percutantes max + un appel à glisser vers la réservation.',
    'photoIdea : brief de prise de vue RÉELLE pour le staff (quoi filmer/photographier sur place, cadrage, moment).',
    'aiImagePrompt : prompt EN ANGLAIS pour un générateur d\'images (scène photo-réaliste du centre, ambiance, lumière) — TOUJOURS finir par "no text, no logos".',
    'hashtags : 5-8 hashtags pertinents (local + activités + occasion), sans doublon.',
    `bestTime : le meilleur créneau de publication pour ${channel} (audience de l'occasion).`,
  ];
}

async function callPackModel({ channel, centerFacts, occasion, theme, brief, angle = null, fixes = [] }) {
  const angleGuidance = angle && angleByKey(angle) ? angleByKey(angle).guidance : null;
  const stableSystem = [
    'Tu es le copywriter senior d\'un centre de loisirs indoor belge (bowling, laser game, arcades). Tu produis un PACK de contenu complet pour UN réseau social.',
    'INTERDITS PRODUIT (au-dessus de tout) : jamais inventer une activité, une disponibilité, une promotion, un prix, une session dédiée ou une promesse garantie. Uniquement les faits fournis.',
    COPY_SYSTEM_CORE,
    'Réponds uniquement en JSON conforme au schéma.',
  ].join('\n\n');
  const result = await callLlmJson({
    stableSystem,
    user: JSON.stringify({
      canal: channelPlaybook(channel),
      centre: { nom: centerFacts.centerName, ville: centerFacts.city, activites: centerFacts.activities, pistes: centerFacts.laneCount },
      angleDuJour: theme.label,
      ...(angleGuidance ? { accrocheOrientee: angleGuidance } : {}),
      faitsDuJour: theme.facts,
      occasion: { label: occasion.label, audience: occasion.audience, accroche: occasion.emotionalHook, promesse: occasion.promise, benefices: (occasion.benefits || []).slice(0, 4) },
      briefGerant: String(brief || '').slice(0, 300) || null,
      formatAttendu: packFormatRules(channel),
      ...(fixes.length ? { corrections: [`Ta version précédente a été refusée par le contrôle qualité. Corrige PRÉCISÉMENT ceci :`, ...fixes] } : {}),
      rappel: COPY_FINAL_REMINDER,
    }),
    schema: PACK_SCHEMA,
    schemaName: 'content_pack',
    // 7 pièces d'un coup ≈ 700-900 tokens de sortie : 11 s ne suffisaient pas
    // (constaté au premier test réel). 2 itérations × 15 s restent sous les
    // 30 s du lambda ops.
    maxTokens: 1000,
    timeoutMs: 15000,
  }).catch(() => null);
  if (!result || !result.long || !result.short) return null;
  return result;
}

function scorePack(pack, { channel, centerFacts, signals }) {
  const longScore = scoreDraft({ text: pack.long, platform: channel, facts: centerFacts, signals });
  const shortScore = scoreDraft({ text: pack.short, platform: channel, facts: centerFacts, signals });
  return {
    long: longScore,
    short: shortScore,
    min: Math.min(longScore.score, shortScore.score),
    blocked: longScore.blocked || shortScore.blocked,
  };
}

function fixesFrom(scores) {
  const weak = [...(scores.long.checks || []), ...(scores.short.checks || [])]
    .filter((check) => Number(check.score) < 80);
  const seen = new Set();
  const fixes = [];
  for (const check of weak) {
    if (seen.has(check.id)) continue;
    seen.add(check.id);
    fixes.push(CRITERION_FIX_HINTS[check.id] || `${check.label} : ${check.note}`);
  }
  if (scores.blocked) fixes.unshift('BLOQUANT : retire toute promesse interdite (disponibilité garantie, session privée, activité absente).');
  return fixes.slice(0, 5);
}

async function generateContentPack(centerId, { platform = 'facebook', brief = '', angle = null } = {}, deps = {}) {
  const channel = STUDIO_CHANNELS.includes(platform) ? platform : null;
  if (!channel) throw httpError('Canal inconnu (facebook, instagram, tiktok, linkedin).');
  const query = deps.query || ((text, params) => getPool().query(text, params));
  // Bandit d'angles : on ÉCHANTILLONNE l'accroche à tester (exploration puis
  // exploitation). Le résultat est tagué sur la proposition → récompensé à la
  // mesure J+14. Fail-soft (sans DB → exploration).
  const angleKey = (angle && angleByKey(angle)) ? angle : await (deps.recommendAngle || recommendAngle)(centerId, { query }).catch(() => null);
  const buildFacts = deps.buildCenterFacts || buildCenterFacts;
  const bundle = deps.bundle || await buildDataFactsBundle(centerId).catch(() => ({}));
  const today = bundle.today || new Date().toISOString().slice(0, 10);
  const centerFacts = buildFacts(centerId);
  const theme = pickStudioTheme(bundle, today);
  const occasion = resolveOccasion(String(brief || '').trim() || theme.occasionId);
  const signals = buildSignalPack({ reservations: [], events: [], suggestions: [], dataFacts: bundle });

  let pack = buildRulesPack({ channel, centerFacts, occasion, theme });
  let best = { pack, scores: scorePack(pack, { channel, centerFacts, signals }), mode: 'rules' };
  const iterations = [{ mode: 'rules', score: best.scores.min }];

  if ((deps.llmProvider || llmProvider)()) {
    let fixes = [];
    for (let attempt = 1; attempt <= MAX_ITERATIONS; attempt += 1) {
      const aiPack = await (deps.callPackModel || callPackModel)({ channel, centerFacts, occasion, theme, brief, angle: angleKey, fixes });
      if (!aiPack) break;
      const candidate = {
        ...aiPack,
        hashtags: [...new Set((aiPack.hashtags || []).map((tag) => String(tag).trim()).filter((tag) => /^#\S{2,30}$/.test(tag)))].slice(0, 8),
        generationMode: 'ai',
        theme: theme.label,
      };
      const scores = scorePack(candidate, { channel, centerFacts, signals });
      iterations.push({ mode: `ai_${attempt}`, score: scores.min, blocked: scores.blocked });
      if (!scores.blocked && scores.min >= best.scores.min) {
        best = { pack: candidate, scores, mode: `ai_${attempt}` };
      }
      if (!scores.blocked && scores.min >= MIN_ACCEPTED_SCORE) break;
      fixes = fixesFrom(scores);
    }
  }

  const finalPack = {
    ...best.pack,
    platform: channel,
    date: today,
    angle: angleKey,
    brief: String(brief || '').slice(0, 300),
    quality: {
      score: best.scores.min,
      longScore: best.scores.long.score,
      shortScore: best.scores.short.score,
      status: best.scores.min >= MIN_ACCEPTED_SCORE ? 'ready' : 'review',
      iterations,
    },
  };

  await query(
    `insert into marketing_agent_runs (center_id, run_id, run_type, status, platform, agent_id, score, summary, payload)
     values ($1,$2,'content_pack','finished',$3,'content-studio',$4,$5,$6::jsonb);`,
    [
      centerId,
      `studio-${today}-${channel}-${Date.now()}`,
      channel,
      best.scores.min,
      `${theme.label} · ${occasion.label}`,
      JSON.stringify(finalPack),
    ],
  ).catch(() => null);

  return finalPack;
}

// Dernier pack du jour par canal (l'ouverture de l'onglet ne génère RIEN —
// zéro coût tant que le gérant ne demande pas).
async function listTodayPacks(centerId, deps = {}) {
  const query = deps.query || ((text, params) => getPool().query(text, params));
  const result = await query(
    `select distinct on (platform) platform, payload, created_at
     from marketing_agent_runs
     where center_id = $1 and run_type = 'content_pack' and created_at::date = current_date
     order by platform, created_at desc;`,
    [centerId],
  ).catch(() => ({ rows: [] }));
  const packs = {};
  for (const channel of STUDIO_CHANNELS) packs[channel] = null;
  for (const row of result.rows) {
    if (STUDIO_CHANNELS.includes(row.platform)) packs[row.platform] = row.payload || null;
  }
  return packs;
}

module.exports = {
  STUDIO_CHANNELS,
  generateContentPack,
  listTodayPacks,
  // Purs / testables
  pickStudioTheme,
  buildRulesPack,
  shortVersionOf,
  scorePack,
  fixesFrom,
};
