const {
  createOpsEvent,
  getPool,
  listAgentSuggestions,
  listOpsEvents,
  readAdminRangeState,
  saveAgentSuggestions,
} = require('./database');
const { loadOpsKnowledge } = require('./ops-knowledge');

const PLATFORM_ORDER = ['facebook', 'instagram', 'tiktok', 'linkedin', 'email'];
const BASE_CRITERIA = [
  {
    id: 'center_truth',
    label: 'Verite centre',
    weight: 2,
    description: 'Le script ne doit utiliser que les activites et contraintes connues du centre.',
  },
  {
    id: 'human_resonance',
    label: 'Impact humain',
    weight: 1.4,
    description: 'Le message parle a une situation reelle: famille, anniversaire, groupe, ecole ou entreprise.',
  },
  {
    id: 'proof_from_data',
    label: 'Preuve locale',
    weight: 1.2,
    description: 'Le script s appuie sur un signal interne: activite forte, jour calme, reservations, capacite.',
  },
  {
    id: 'clear_cta',
    label: 'Action claire',
    weight: 1,
    description: 'Le lecteur sait quoi faire sans lire deux fois.',
  },
  {
    id: 'readability',
    label: 'Lecture facile',
    weight: 1,
    description: 'Phrases courtes, pas de jargon, pas de promesse floue.',
  },
  {
    id: 'risk_guardrail',
    label: 'Garde-fou',
    weight: 1.8,
    description: 'Aucune promesse de disponibilite, de session privee ou d activite absente.',
  },
];

const PLATFORM_CRITERIA = {
  facebook: [
    { id: 'facebook_local', label: 'Local et partageable', weight: 1.2, description: 'Message simple pour familles et groupes locaux.' },
  ],
  instagram: [
    { id: 'instagram_visual', label: 'Scene visuelle', weight: 1.2, description: 'Donne une idee claire de visuel reel a filmer ou poster.' },
  ],
  tiktok: [
    { id: 'tiktok_hook', label: 'Hook rapide', weight: 1.2, description: 'Les deux premieres secondes sont comprenables.' },
  ],
  linkedin: [
    { id: 'linkedin_business', label: 'Angle pro', weight: 1.2, description: 'Utile pour ecoles, clubs, entreprises ou responsables equipe.' },
  ],
  email: [
    { id: 'email_human', label: 'Humain direct', weight: 1.2, description: 'On dirait un message ecrit par une vraie personne du centre.' },
  ],
};

const PLATFORM_AGENTS = {
  facebook: {
    id: 'facebook-marketing-agent',
    label: 'Agent Facebook',
    mission: 'Transforme les signaux du centre en message local clair pour familles et groupes.',
    connectorEnv: 'META_ACCESS_TOKEN',
  },
  instagram: {
    id: 'instagram-marketing-agent',
    label: 'Agent Instagram',
    mission: 'Prepare une legende et un brief visuel reels, sans activite inventee.',
    connectorEnv: 'META_ACCESS_TOKEN',
  },
  tiktok: {
    id: 'tiktok-marketing-agent',
    label: 'Agent TikTok',
    mission: 'Ecrit un mini-script filmable par le staff avec hook court et scenes terrain.',
    connectorEnv: 'TIKTOK_ACCESS_TOKEN',
  },
  linkedin: {
    id: 'linkedin-marketing-agent',
    label: 'Agent LinkedIn',
    mission: 'Produit un angle B2B credible pour ecoles, clubs, entreprises et managers.',
    connectorEnv: 'LINKEDIN_ACCESS_TOKEN',
  },
  email: {
    id: 'email-marketing-agent',
    label: 'Agent Email',
    mission: 'Redige un message court, humain et precis pour relance ou annonce locale.',
    connectorEnv: 'RESEND_API_KEY',
  },
};

const MARKETING_PLAYBOOK_SIGNALS = {
  facebook: {
    topic: 'sortie locale famille anniversaire',
    hook: 'Une sortie simple a organiser pour un anniversaire, une famille ou un groupe local',
    angle: 'proximite et organisation facile',
    keywords: ['anniversaire', 'famille', 'groupe', 'sortie locale', 'demandez une dispo'],
  },
  instagram: {
    topic: 'scene reelle bowling laser arcades',
    hook: 'Montrer le centre en vrai, pas une promesse abstraite',
    angle: 'visuels terrain courts et authentiques',
    keywords: ['a filmer', 'bowling', 'laser game', 'arcades', 'sourire final'],
  },
  tiktok: {
    topic: 'hook rapide organisation groupe',
    hook: 'Quand tu dois organiser une sortie pour tout le monde sans te prendre la tete',
    angle: 'format scene par scene, tres simple a filmer',
    keywords: ['hook', 'plan 1', 'groupe', 'anniversaire', 'laser game'],
  },
  linkedin: {
    topic: 'sortie entreprise ecole club',
    hook: 'Organiser une sortie de groupe ne devrait pas devenir un mini-projet interne',
    angle: 'benefice B2B: equipe, ecole, club, manager',
    keywords: ['ecole', 'equipe', 'entreprise', 'club', 'organisation'],
  },
  email: {
    topic: 'message humain court',
    hook: 'Un message qui ressemble a une vraie personne du centre',
    angle: 'date, nombre de personnes, prochaine action claire',
    keywords: ['bonjour', 'date en tete', 'nombre de personnes', 'horaire souhaite', 'Fun Galaxy'],
  },
};

const MARKETING_OBJECTIVE_PLAYBOOK_SIGNALS = {
  facebook: [
    {
      topic: 'anniversaire enfant famille locale',
      hook: 'Un anniversaire facile a expliquer aux parents et simple a reserver',
      angle: 'parents, enfants, organisation sans stress',
      keywords: ['anniversaire', 'parents', 'enfants', 'famille', 'date'],
    },
    {
      topic: 'sortie groupe club ecole',
      hook: 'Une sortie groupe indoor avec bowling, laser game ou formules selon le centre',
      angle: 'groupe local et organisation claire',
      keywords: ['groupe', 'club', 'ecole', 'indoor', 'organisation'],
    },
  ],
  instagram: [
    {
      topic: 'reel arrivee centre activites',
      hook: 'Montrer le trajet client: entree, activite, moment fort, sourire final',
      angle: 'sequence courte et vraie',
      keywords: ['reel', 'entree', 'moment fort', 'sourire', 'a filmer'],
    },
    {
      topic: 'carrousel anniversaire',
      hook: 'Avant, pendant, apres: un anniversaire visuel et facile a comprendre',
      angle: 'carrousel lisible pour parents',
      keywords: ['carrousel', 'anniversaire', 'parents', 'bowling', 'laser game'],
    },
  ],
  tiktok: [
    {
      topic: 'script sortie minute',
      hook: 'Tu dois organiser une sortie pour un groupe et personne nest daccord',
      angle: 'humour court sans surpromesse',
      keywords: ['organiser', 'groupe', 'pas daccord', 'hook', 'plan'],
    },
    {
      topic: 'avant apres anniversaire',
      hook: 'POV: tu cherches une activite indoor pour un anniversaire',
      angle: 'pov simple et local',
      keywords: ['pov', 'anniversaire', 'indoor', 'famille', 'amis'],
    },
  ],
  linkedin: [
    {
      topic: 'cohesion equipe entreprise',
      hook: 'Une sortie equipe doit etre simple a caler et claire a organiser',
      angle: 'team building, RH, manager',
      keywords: ['equipe', 'entreprise', 'manager', 'team building', 'organisation'],
    },
    {
      topic: 'ecole club planning propre',
      hook: 'Les groupes scolaires et clubs ont besoin dun cadre clair, pas dune promesse floue',
      angle: 'responsables groupe et planning',
      keywords: ['ecole', 'club', 'responsable', 'planning', 'groupe'],
    },
  ],
  email: [
    {
      topic: 'relance humaine anniversaire',
      hook: 'Un message court qui aide a choisir une date et un nombre de personnes',
      angle: 'humain, utile, pas promotionnel',
      keywords: ['bonjour', 'anniversaire', 'date', 'personnes', 'repondre'],
    },
    {
      topic: 'message groupe direct',
      hook: 'Demander les infos utiles sans transformer le mail en publicite',
      angle: 'groupe, disponibilite, precision',
      keywords: ['groupe', 'disponibilite', 'horaire', 'centre', 'merci'],
    },
  ],
};

let marketingSchemaReady = false;

const AUTONOMY_WEIGHTS = {
  database: 15,
  scheduler: 12,
  guardrails: 18,
  generation: 15,
  officialConnectors: 15,
  learningSignals: 12,
  recentActivity: 8,
  lowRisk: 5,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeCenterId(centerId) {
  return normalizeText(centerId, 'libramont') || 'libramont';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function lower(value) {
  return stripAccents(value).toLowerCase();
}

function getMarketingPlatforms() {
  return PLATFORM_ORDER.map((platform) => ({
    platform,
    ...PLATFORM_AGENTS[platform],
    connected: Boolean(process.env[PLATFORM_AGENTS[platform].connectorEnv]),
  }));
}

async function ensureMarketingSchema() {
  if (marketingSchemaReady) return;
  const client = await getPool().connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['marketing_agent_schema_v1']);
    await client.query(`
      create table if not exists marketing_agent_runs (
        id bigserial primary key,
        center_id text not null default 'libramont',
        run_id text not null,
        run_type text not null default 'cycle',
        status text not null default 'finished',
        platform text not null default 'all',
        agent_id text not null,
        score numeric(5,2) not null default 0,
        summary text not null default '',
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );

      create index if not exists marketing_agent_runs_center_idx
        on marketing_agent_runs (center_id, created_at desc);

      create index if not exists marketing_agent_runs_run_idx
        on marketing_agent_runs (run_id);

      create table if not exists marketing_agent_criteria (
        id bigserial primary key,
        center_id text not null default 'global',
        platform text not null,
        criterion_id text not null,
        label text not null,
        description text not null default '',
        weight numeric(6,3) not null default 1,
        evidence jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        unique(center_id, platform, criterion_id)
      );

      create table if not exists marketing_social_observations (
        id bigserial primary key,
        center_id text not null default 'global',
        platform text not null,
        source text not null default 'manual',
        signal_type text not null default 'benchmark',
        payload jsonb not null default '{}'::jsonb,
        observed_at timestamptz not null default now(),
        created_at timestamptz not null default now()
      );

      create index if not exists marketing_social_observations_idx
        on marketing_social_observations (center_id, platform, observed_at desc);
    `);
    marketingSchemaReady = true;
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', ['marketing_agent_schema_v1']).catch(() => null);
    client.release();
  }
}

function getKnowledgeCenter(centerId = 'libramont', knowledge = loadOpsKnowledge()) {
  return (knowledge.centers || []).find((center) => center.id === centerId)
    || (knowledge.centers || []).find((center) => center.id === 'libramont')
    || {};
}

function getActivityName(activityId, knowledge = loadOpsKnowledge()) {
  const activity = (knowledge.activities || []).find((item) => item.id === activityId);
  return activity?.name || activityId;
}

function buildCenterFacts(centerId = 'libramont', knowledge = loadOpsKnowledge()) {
  const center = getKnowledgeCenter(centerId, knowledge);
  const availability = center.activityAvailability || {};
  const activities = Object.keys(availability)
    .filter((activityId) => availability[activityId])
    .map((activityId) => getActivityName(activityId, knowledge))
    .filter(Boolean);
  const hasGolfOClock = Boolean(availability.golf_oclock);
  const city = center.name?.replace(/^Fun Galaxy\s*/i, '') || centerId;

  const forbiddenClaims = [
    'cinema',
    'escape game',
    'session laser privee garantie',
    'session laser privee',
    'laser prive garanti',
    'disponibilite garantie',
    'places garanties',
    '100% disponible',
    'reduction garantie',
    'karting reel',
  ];
  if (!hasGolfOClock) {
    forbiddenClaims.push("golf o'clock", 'golf oclock');
  }

  return {
    centerId: center.id || centerId,
    centerName: center.name || `Fun Galaxy ${centerId}`,
    city,
    laneCount: toNumber(center.resources?.bowling?.laneCount, 8),
    weaponCount: toNumber(center.resources?.laser?.weaponCount, 30),
    parallelLaunches: toNumber(center.resources?.laser?.parallelLaunches, 1),
    requiresCompleteLaserGroup: Boolean(center.resources?.laser?.requiresCompleteGroupBeforeLaunch),
    activities,
    activityAvailability: availability,
    hasGolfOClock,
    forbiddenClaims,
  };
}

function getReservationType(reservation = {}) {
  const type = normalizeText(reservation.type || reservation.reservationType || '').toLowerCase();
  if (type === 'laser') return 'laser';
  if (type === 'formule') return 'formule';
  return 'bowling';
}

function buildSignalPack(context = {}) {
  const reservations = Array.isArray(context.reservations) ? context.reservations : [];
  const activeReservations = reservations.filter((reservation) => reservation.status !== 'cancelled');
  const byType = activeReservations.reduce((acc, reservation) => {
    const type = getReservationType(reservation);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, { bowling: 0, laser: 0, formule: 0 });
  const players = activeReservations.reduce((sum, reservation) => sum + toNumber(reservation.pax, 0), 0);
  const revenue = activeReservations.reduce((sum, reservation) => sum + toNumber(reservation.price, 0), 0);
  const groups = activeReservations.filter((reservation) => toNumber(reservation.pax, 0) >= 10).length;
  const formulas = activeReservations.filter((reservation) => getReservationType(reservation) === 'formule').length;
  const laserSensitive = activeReservations.some((reservation) => getReservationType(reservation) === 'laser' && toNumber(reservation.pax, 0) >= 18);
  const quiet = activeReservations.length <= 3;
  const eventCount = Array.isArray(context.events) ? context.events.length : 0;
  const suggestions = Array.isArray(context.suggestions) ? context.suggestions : [];
  const highSuggestions = suggestions.filter((suggestion) => ['high', 'critical'].includes(suggestion.severity)).length;

  return {
    reservationCount: activeReservations.length,
    players,
    revenue,
    groups,
    formulas,
    byType,
    quiet,
    laserSensitive,
    eventCount,
    highSuggestions,
    dateRange: {
      startDate: context.startDate || '',
      endDate: context.endDate || '',
    },
  };
}

function chooseObjective(signals, requested = '') {
  const normalized = normalizeText(requested).toLowerCase();
  if (normalized) return normalized;
  if (signals.quiet) return 'calme';
  if (signals.byType.formule >= 2 || signals.formulas >= 2) return 'formules';
  if (signals.byType.laser >= signals.byType.bowling) return 'laser';
  if (signals.groups >= 2) return 'groupes';
  return 'anniversaires';
}

function defaultCriteriaFor(platform) {
  return [...BASE_CRITERIA, ...(PLATFORM_CRITERIA[platform] || [])];
}

async function ensureDefaultCriteria(centerId) {
  await ensureMarketingSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const platform of PLATFORM_ORDER) {
      for (const criterion of defaultCriteriaFor(platform)) {
        await client.query(
          `
            insert into marketing_agent_criteria (
              center_id,
              platform,
              criterion_id,
              label,
              description,
              weight,
              evidence,
              updated_at
            ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
            on conflict (center_id, platform, criterion_id)
            do update set
              label = excluded.label,
              description = excluded.description,
              weight = excluded.weight,
              evidence = marketing_agent_criteria.evidence || excluded.evidence,
              updated_at = now();
          `,
          [
            centerId,
            platform,
            criterion.id,
            criterion.label,
            criterion.description,
            criterion.weight,
            JSON.stringify({ source: 'default_marketing_agent', lastSeen: new Date().toISOString() }),
          ],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureMarketingPlaybookSignals(centerId) {
  await ensureMarketingSchema();
  const existing = await getPool().query(
    `
      select count(*)::int as count
      from marketing_social_observations
      where center_id = $1
        and source = 'internal_playbook'
        and signal_type = 'strategy_seed';
    `,
    [centerId],
  );
  if (Number(existing.rows[0]?.count || 0) >= PLATFORM_ORDER.length) return;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const platform of PLATFORM_ORDER) {
      const payload = MARKETING_PLAYBOOK_SIGNALS[platform];
      await client.query(
        `
          insert into marketing_social_observations (
            center_id,
            platform,
            source,
            signal_type,
            payload,
            observed_at
          )
          select $1,$2,'internal_playbook','strategy_seed',$3::jsonb,now()
          where not exists (
            select 1
            from marketing_social_observations
            where center_id = $1
              and platform = $2
              and source = 'internal_playbook'
              and signal_type = 'strategy_seed'
          );
        `,
        [centerId, platform, JSON.stringify(payload)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadCriteriaRows(centerId, platform) {
  await ensureDefaultCriteria(centerId);
  const result = await getPool().query(
    `
      select criterion_id, label, description, weight, evidence
      from marketing_agent_criteria
      where center_id = $1 and platform = $2
      order by id asc;
    `,
    [centerId, platform],
  );
  return result.rows.map((row) => ({
    id: row.criterion_id,
    label: row.label,
    description: row.description,
    weight: toNumber(row.weight, 1),
    evidence: row.evidence || {},
  }));
}

function readEnvSocialSignals() {
  const raw = process.env.MARKETING_SOCIAL_SIGNALS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function loadSocialObservations(centerId) {
  await ensureMarketingSchema();
  const result = await getPool().query(
    `
      select center_id, platform, source, signal_type, payload, observed_at
      from marketing_social_observations
      where center_id in ($1, 'global')
      order by observed_at desc
      limit 120;
    `,
    [centerId],
  );
  return result.rows.map((row) => ({
    centerId: row.center_id,
    platform: row.platform,
    source: row.source,
    signalType: row.signal_type,
    payload: row.payload || {},
    observedAt: row.observed_at,
  }));
}

async function recordMarketingFeedback(input = {}) {
  const centerId = normalizeCenterId(input.centerId);
  const platform = PLATFORM_ORDER.includes(input.platform) ? input.platform : 'facebook';
  await ensureMarketingSchema();
  const source = normalizeText(input.source, 'manual');
  const signalType = normalizeText(input.signalType, 'feedback');
  const payload = input.payload || {};
  const result = await getPool().query(
    `
      insert into marketing_social_observations (
        center_id,
        platform,
        source,
        signal_type,
        payload,
        observed_at
      ) values ($1,$2,$3,$4,$5::jsonb,now())
      returning *;
    `,
    [
      centerId,
      platform,
      source,
      signalType,
      JSON.stringify(payload),
    ],
  );
  await learnCriteriaFromObservation({
    centerId,
    platform,
    source,
    signalType,
    payload,
  });
  await createOpsEvent({
    centerId,
    eventType: 'marketing_feedback_recorded',
    payload: {
      platform,
      source,
      signalType,
    },
  });
  return {
    ok: true,
    observation: {
      id: Number(result.rows[0].id),
      centerId: result.rows[0].center_id,
      platform: result.rows[0].platform,
      payload: result.rows[0].payload || {},
      observedAt: result.rows[0].observed_at,
    },
  };
}

async function buildMarketingContext({
  centerId = 'libramont',
  startDate = daysAgoIso(30),
  endDate = todayIso(),
} = {}) {
  const safeCenterId = normalizeCenterId(centerId);
  const knowledge = loadOpsKnowledge();
  await ensureMarketingPlaybookSignals(safeCenterId);
  const [rangeState, suggestions, events, observations] = await Promise.all([
    readAdminRangeState(startDate, endDate, safeCenterId),
    listAgentSuggestions({ centerId: safeCenterId, status: 'pending', limit: 120 }),
    listOpsEvents({ centerId: safeCenterId, limit: 300 }),
    loadSocialObservations(safeCenterId),
  ]);
  return {
    centerId: safeCenterId,
    startDate,
    endDate,
    knowledge,
    reservations: rangeState.reservations || [],
    laneStatuses: rangeState.laneStatuses || {},
    suggestions,
    events,
    observations: [...observations, ...readEnvSocialSignals()],
    syncedAt: rangeState.syncedAt,
  };
}

function socialSignalSummary(platform, observations = []) {
  const relevant = observations.filter((item) => item.platform === platform || item.platform === 'all');
  if (!relevant.length) {
    return 'Analyse interne active. Donnees externes non injectees.';
  }
  const latest = relevant[0];
  const topic = latest.payload?.topic || latest.payload?.hook || latest.signalType || 'signal reseau';
  return `${relevant.length} signal(s) reseau pris en compte. Dernier: ${topic}.`;
}

function getOpenAiMarketingModel() {
  return process.env.OPENAI_MARKETING_MODEL || 'gpt-4.1-mini';
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') return part.text;
    }
  }
  return '';
}

async function callOpenAiMarketingAgent({ platform, facts, signals, objective, brief, observations }) {
  if (!process.env.OPENAI_API_KEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: getOpenAiMarketingModel(),
        input: [
          {
            role: 'system',
            content: [
              'Tu es un agent marketing operationnel Fun Galaxy.',
              'Tu dois produire un script en francais naturel, humain, simple et vendable.',
              'Tu ne dois jamais inventer une activite, une disponibilite, une promotion, une session privee ou une promesse.',
              'Tu dois adapter le style au reseau social et garder une information claire pour Libramont/Gembloux.',
              'Reponds uniquement en JSON conforme au schema.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              platform,
              objective,
              brief,
              centerFacts: facts,
              internalSignals: signals,
              socialSignals: (observations || []).slice(0, 12),
              outputRules: [
                'Le texte doit etre directement publiable ou copiable.',
                'Mentionner le centre exact.',
                'Ne pas dire Golf oClock si le centre ne le propose pas.',
                'Ne pas promettre de session Laser Game privee.',
                'Toujours garder un appel a action simple.',
              ],
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'fun_galaxy_marketing_script',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                rationale: { type: 'string' },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['title', 'body', 'rationale', 'keywords'],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rawText = extractOpenAiText(payload);
    if (!rawText) return null;
    const parsed = JSON.parse(rawText);
    if (!parsed.body || typeof parsed.body !== 'string') return null;
    return {
      platform,
      title: normalizeText(parsed.title, `Script ${platform} - ${facts.centerName}`),
      body: parsed.body.trim(),
      aiRationale: normalizeText(parsed.rationale),
      aiKeywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((item) => normalizeText(item)).filter(Boolean) : [],
      generationMode: 'openai',
      model: getOpenAiMarketingModel(),
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildBestDraftForPlatform({ platform, facts, signals, objective, brief, observations, criteria }) {
  const templateDraft = {
    ...buildDraftForPlatform({ platform, facts, signals, objective, brief }),
    generationMode: 'rules',
  };
  const templateScore = scoreDraft({ text: templateDraft.body, platform, facts, signals, criteria });
  const aiDraft = await callOpenAiMarketingAgent({ platform, facts, signals, objective, brief, observations });
  const aiAttempted = Boolean(process.env.OPENAI_API_KEY);
  if (!aiDraft) return { draft: templateDraft, evaluation: templateScore, fallbackUsed: false, aiAttempted };
  const aiScore = scoreDraft({ text: aiDraft.body, platform, facts, signals, criteria });
  if (!aiScore.blocked && aiScore.score >= templateScore.score) {
    return { draft: aiDraft, evaluation: aiScore, fallbackUsed: false, aiAttempted };
  }
  return {
    draft: {
      ...templateDraft,
      rejectedAi: {
        score: aiScore.score,
        status: aiScore.status,
        summary: aiScore.summary,
      },
    },
    evaluation: templateScore,
    fallbackUsed: true,
    aiAttempted,
  };
}

function slugifyCriterion(value) {
  return lower(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'signal';
}

function extractObservationKeywords(payload = {}) {
  const raw = [
    payload.topic,
    payload.hook,
    payload.angle,
    payload.pattern,
    ...(Array.isArray(payload.keywords) ? payload.keywords : []),
  ].filter(Boolean);
  return [...new Set(raw.map((item) => normalizeText(item)).filter(Boolean))].slice(0, 8);
}

async function learnCriteriaFromObservation({ centerId, platform, source = 'manual', signalType, payload }) {
  const keywords = extractObservationKeywords(payload);
  if (!keywords.length && !normalizeText(payload?.notes) && !normalizeText(payload?.caption)) {
    return { criterionId: null, keywords: [], weight: 0, skipped: true };
  }
  const main = keywords[0] || normalizeText(payload?.notes).slice(0, 40) || signalType || 'signal';
  const positiveMetric = Math.max(
    toNumber(payload.engagementRate, 0) * 100,
    toNumber(payload.leads, 0) * 8,
    toNumber(payload.saves, 0) * 2,
    toNumber(payload.replies, 0) * 3,
    toNumber(payload.clicks, 0),
  );
  const weight = clamp(0.85 + (positiveMetric / 100), 0.75, 1.8);
  const criterionId = `observed_${slugifyCriterion(main)}`;
  await getPool().query(
    `
      insert into marketing_agent_criteria (
        center_id,
        platform,
        criterion_id,
        label,
        description,
        weight,
        evidence,
        updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
      on conflict (center_id, platform, criterion_id)
      do update set
        label = excluded.label,
        description = excluded.description,
        weight = greatest(marketing_agent_criteria.weight, excluded.weight),
        evidence = marketing_agent_criteria.evidence || excluded.evidence,
        updated_at = now();
    `,
    [
      centerId,
      platform,
      criterionId,
      `Signal observe: ${main}`,
      'Critere appris depuis un signal ou une performance reseau social.',
      weight,
      JSON.stringify({
        source,
        signalType,
        keywords,
        lastPayload: payload,
        lastSeen: new Date().toISOString(),
      }),
    ],
  );
  return { criterionId, keywords, weight };
}

async function learnCriteriaFromObservations(centerId, observations = []) {
  const learned = [];
  for (const observation of observations.slice(0, 30)) {
    const platforms = observation.platform === 'all' ? PLATFORM_ORDER : [observation.platform];
    for (const platform of platforms.filter((item) => PLATFORM_ORDER.includes(item))) {
      const result = await learnCriteriaFromObservation({
        centerId,
        platform,
        source: observation.source || 'observation',
        signalType: observation.signalType || observation.signal_type || 'benchmark',
        payload: observation.payload || {},
      });
      if (!result.skipped) learned.push({ platform, ...result });
    }
  }
  return learned;
}

function sentenceForObjective(objective, facts, signals) {
  if (objective.includes('laser')) {
    return facts.requiresCompleteLaserGroup
      ? `A ${facts.city}, le Laser Game se prepare mieux quand le groupe arrive complet: ${facts.weaponCount} armes disponibles, mais un seul lancement sensible au timing.`
      : `A ${facts.city}, le Laser Game permet des groupes plus souples avec ${facts.weaponCount} armes et plusieurs lancements possibles.`;
  }
  if (objective.includes('formule')) {
    return `Les formules combinent les activites qui comptent vraiment: bowling, Laser Game, arcades, anniversaire et temps libre sur place.`;
  }
  if (objective.includes('groupe')) {
    return `Pour une ecole, un club ou une equipe, Fun Galaxy ${facts.city} evite l organisation compliquee: tout est au meme endroit.`;
  }
  if (objective.includes('calme')) {
    return `Certains jours sont plus simples pour profiter du centre avec moins d attente et une organisation plus fluide.`;
  }
  if (objective.includes('fidel')) {
    return `Une sortie qui marche bien, c est souvent celle qu on refait: anniversaire, famille, amis ou equipe.`;
  }
  if (signals.groups > 0) {
    return `Les groupes reviennent parce que le centre couvre plusieurs envies sans disperser tout le monde.`;
  }
  return `Un anniversaire ou une sortie en famille doit rester simple: on reserve, on arrive, l equipe accompagne le depart.`;
}

function buildDraftForPlatform({
  platform = 'facebook',
  facts = buildCenterFacts(),
  signals = buildSignalPack(),
  objective = '',
  brief = '',
} = {}) {
  const safeObjective = chooseObjective(signals, objective);
  const proof = signals.reservationCount > 0
    ? `${signals.reservationCount} reservation(s) et ${signals.players} joueur(s) observes sur la periode.`
    : `${facts.laneCount} pistes bowling et ${facts.weaponCount} armes Laser Game disponibles selon les horaires du centre.`;
  const activityLine = facts.activities.slice(0, 6).join(', ');
  const base = sentenceForObjective(safeObjective, facts, signals);
  const briefLine = normalizeText(brief) ? `Angle demande: ${normalizeText(brief)}` : '';

  if (platform === 'linkedin') {
    return {
      platform,
      title: `Post LinkedIn - ${facts.centerName}`,
      body: [
        `Organiser une sortie de groupe ne devrait pas devenir un mini-projet interne.`,
        '',
        base,
        '',
        `Cote terrain: ${proof}`,
        `Activites reelles du centre: ${activityLine}.`,
        facts.requiresCompleteLaserGroup
          ? `Point important: a Libramont, le Laser Game demande un groupe complet au bon moment pour garder le planning propre.`
          : `Point important: le Laser Game reste organise selon l affluence et la capacite disponible.`,
        briefLine,
        '',
        `Pour une ecole, une equipe ou un anniversaire, le plus simple reste de demander une disponibilite et de caler le bon enchainement.`,
      ].filter(Boolean).join('\n'),
    };
  }

  if (platform === 'instagram') {
    return {
      platform,
      title: `Legende Instagram - ${facts.centerName}`,
      body: [
        `Une sortie qui garde tout le monde ensemble.`,
        '',
        `A ${facts.city}: ${activityLine}.`,
        base,
        '',
        `A filmer: arrivee du groupe, chaussures bowling, depart Laser Game, arcades, sourire final.`,
        facts.requiresCompleteLaserGroup ? `Laser Game possible avec d autres joueurs selon l affluence.` : `Laser Game organise selon l affluence du moment.`,
        briefLine,
        '',
        `Demandez une dispo pour votre date.`,
      ].filter(Boolean).join('\n'),
    };
  }

  if (platform === 'tiktok') {
    return {
      platform,
      title: `Script TikTok - ${facts.centerName}`,
      body: [
        `Hook: "Quand tu dois organiser une sortie pour tout le groupe sans te prendre la tete..."`,
        `Plan 1: entree du centre + texte "${facts.city}".`,
        `Plan 2: bowling en action, ${facts.laneCount} pistes.`,
        `Plan 3: Laser Game, ${facts.weaponCount} armes, briefing rapide.`,
        `Plan 4: arcades / anniversaire / groupe qui repart content.`,
        `Voix off: ${base}`,
        facts.requiresCompleteLaserGroup ? `Note staff: ne pas promettre une session privee Laser Game.` : `Note staff: parler de disponibilite, pas de garantie.`,
        briefLine,
      ].filter(Boolean).join('\n'),
    };
  }

  if (platform === 'email') {
    return {
      platform,
      title: `Email - ${facts.centerName}`,
      body: [
        `Objet: Une sortie simple a organiser chez Fun Galaxy ${facts.city}`,
        '',
        `Bonjour,`,
        '',
        base,
        '',
        `Sur place, vous pouvez retrouver: ${activityLine}.`,
        `Côté organisation, nous adaptons le meilleur enchaînement selon la date, le nombre de personnes et les disponibilités bowling / Laser Game.`,
        facts.requiresCompleteLaserGroup ? `Pour le Laser Game, le groupe doit idealement arriver complet afin d eviter les retards.` : `Le Laser Game reste organise selon l affluence du moment.`,
        briefLine,
        '',
        `Si vous avez une date en tete, envoyez-nous le nombre de personnes et l horaire souhaite.`,
        '',
        `Fun Galaxy ${facts.city}`,
      ].filter(Boolean).join('\n'),
    };
  }

  return {
    platform: 'facebook',
    title: `Publication Facebook - ${facts.centerName}`,
    body: [
      `Vous cherchez une sortie simple pour un anniversaire, une famille ou un groupe ?`,
      '',
      base,
      '',
      `A ${facts.city}, vous pouvez profiter de: ${activityLine}.`,
      `Info pratique: ${proof}`,
      facts.requiresCompleteLaserGroup ? `Le Laser Game peut etre partage selon l affluence et demande un groupe complet au lancement.` : `Le Laser Game peut etre partage selon l affluence.`,
      briefLine,
      '',
      `Demandez une disponibilite et on vous aide a choisir le bon moment.`,
    ].filter(Boolean).join('\n'),
  };
}

function forbiddenHits(text, facts) {
  const normalized = lower(text);
  return (facts.forbiddenClaims || []).filter((claim) => normalized.includes(lower(claim)));
}

function scoreCriterion(criterion, { text, platform, facts, signals }) {
  const normalized = lower(text);
  if (criterion.id === 'center_truth') {
    const hits = forbiddenHits(text, facts);
    return hits.length ? { score: 0, note: `Claim interdit: ${hits.join(', ')}` } : { score: 100, note: 'Aucune activite absente detectee.' };
  }
  if (criterion.id === 'risk_guardrail') {
    const risky = ['garanti', 'privee', 'prive garanti', 'sans attente'].filter((word) => normalized.includes(lower(word)));
    return risky.length ? { score: 45, note: `Promesse a surveiller: ${risky.join(', ')}` } : { score: 92, note: 'Promesses prudentes.' };
  }
  if (criterion.id === 'human_resonance') {
    const hasAudience = ['famille', 'anniversaire', 'groupe', 'ecole', 'equipe', 'club', 'amis'].some((word) => normalized.includes(word));
    return { score: hasAudience ? 90 : 62, note: hasAudience ? 'Audience claire.' : 'Audience pas assez concrete.' };
  }
  if (criterion.id === 'proof_from_data') {
    const hasProof = /\d/.test(text) || signals.reservationCount > 0;
    return { score: hasProof ? 88 : 60, note: hasProof ? 'Preuve ou chiffre present.' : 'Ajouter un signal concret.' };
  }
  if (criterion.id === 'clear_cta') {
    const hasCta = ['demandez', 'reserve', 'envoyez', 'dispo', 'contact'].some((word) => normalized.includes(word));
    return { score: hasCta ? 88 : 55, note: hasCta ? 'Action claire.' : 'CTA faible.' };
  }
  if (criterion.id === 'readability') {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const longLines = lines.filter((line) => line.length > 170).length;
    return { score: longLines ? 70 : 92, note: longLines ? 'Certaines lignes sont longues.' : 'Lecture fluide.' };
  }
  if (criterion.id === 'facebook_local') {
    return { score: normalized.includes(lower(facts.city)) ? 90 : 68, note: normalized.includes(lower(facts.city)) ? 'Ville citee.' : 'Ville a rendre plus visible.' };
  }
  if (criterion.id === 'instagram_visual') {
    return { score: normalized.includes('filmer') || normalized.includes('plan') ? 90 : 65, note: 'Brief visuel verifie.' };
  }
  if (criterion.id === 'tiktok_hook') {
    return { score: normalized.includes('hook') || normalized.includes('plan 1') ? 90 : 62, note: 'Hook court present.' };
  }
  if (criterion.id === 'linkedin_business') {
    const ok = ['ecole', 'equipe', 'entreprise', 'club'].some((word) => normalized.includes(word));
    return { score: ok ? 90 : 64, note: ok ? 'Angle pro present.' : 'Angle B2B trop faible.' };
  }
  if (criterion.id === 'email_human') {
    return { score: normalized.includes('bonjour') && normalized.includes('fun galaxy') ? 90 : 68, note: 'Format email controle.' };
  }
  if (String(criterion.id || '').startsWith('observed_')) {
    const keywords = Array.isArray(criterion.evidence?.keywords)
      ? criterion.evidence.keywords.map((item) => lower(item)).filter(Boolean)
      : [];
    if (!keywords.length) {
      return { score: 76, note: 'Signal appris sans mot-cle exploitable.' };
    }
    const matches = keywords.filter((keyword) => keyword && normalized.includes(keyword));
    return {
      score: matches.length ? 90 : 66,
      note: matches.length
        ? `Pattern appris retrouve: ${matches.slice(0, 3).join(', ')}`
        : `Pattern appris absent: ${keywords.slice(0, 3).join(', ')}`,
    };
  }
  return { score: 80, note: 'Critere controle.' };
}

function scoreDraft({ text, platform, facts, signals, criteria = defaultCriteriaFor(platform) }) {
  const checks = criteria.map((criterion) => {
    const result = scoreCriterion(criterion, { text, platform, facts, signals });
    return {
      id: criterion.id,
      label: criterion.label,
      weight: toNumber(criterion.weight, 1),
      score: clamp(toNumber(result.score, 0), 0, 100),
      note: result.note,
    };
  });
  const weightedTotal = checks.reduce((sum, check) => sum + (check.score * check.weight), 0);
  const weightTotal = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const hits = forbiddenHits(text, facts);
  const rawScore = weightedTotal / weightTotal;
  const score = hits.length ? Math.min(rawScore, 35) : rawScore;
  return {
    score: Math.round(score),
    status: hits.length ? 'blocked' : score >= 85 ? 'ready' : score >= 70 ? 'review' : 'needs_work',
    blocked: hits.length > 0,
    forbiddenHits: hits,
    checks,
    summary: hits.length
      ? `Bloque: ${hits.join(', ')}`
      : score >= 85
        ? 'Script utilisable apres relecture humaine rapide.'
        : 'Script a ameliorer avant utilisation.',
  };
}

async function persistRunRow(row) {
  await getPool().query(
    `
      insert into marketing_agent_runs (
        center_id,
        run_id,
        run_type,
        status,
        platform,
        agent_id,
        score,
        summary,
        payload
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb);
    `,
    [
      row.centerId,
      row.runId,
      row.runType || 'cycle',
      row.status || 'finished',
      row.platform,
      row.agentId,
      row.score || 0,
      row.summary || '',
      JSON.stringify(row.payload || {}),
    ],
  );
}

async function runMarketingAgentCycle({
  centerId = 'libramont',
  startDate = daysAgoIso(30),
  endDate = todayIso(),
  objective = '',
  brief = '',
  persist = true,
  runType = 'manual',
} = {}) {
  const safeCenterId = normalizeCenterId(centerId);
  await ensureMarketingSchema();
  const context = await buildMarketingContext({ centerId: safeCenterId, startDate, endDate });
  const facts = buildCenterFacts(safeCenterId, context.knowledge);
  const signals = buildSignalPack(context);
  const runObjective = chooseObjective(signals, objective);
  const runId = `marketing-${safeCenterId}-${Date.now()}`;
  const learnedCriteria = await learnCriteriaFromObservations(safeCenterId, context.observations);
  const drafts = [];
  const agents = [];
  const suggestions = [];

  for (const platform of PLATFORM_ORDER) {
    const agent = PLATFORM_AGENTS[platform];
    const criteria = await loadCriteriaRows(safeCenterId, platform);
    const {
      draft,
      evaluation,
      fallbackUsed,
      aiAttempted,
    } = await buildBestDraftForPlatform({
      platform,
      facts,
      signals,
      objective: runObjective,
      brief,
      observations: context.observations,
      criteria,
    });
    const socialSummary = socialSignalSummary(platform, context.observations);
    const severity = evaluation.blocked ? 'critical' : evaluation.score < 70 ? 'high' : evaluation.score < 85 ? 'medium' : 'info';

    const payload = {
      ...draft,
      centerId: safeCenterId,
      centerName: facts.centerName,
      objective: runObjective,
      evaluation,
      signals,
      socialSummary,
      factsUsed: {
        activities: facts.activities,
        laneCount: facts.laneCount,
        weaponCount: facts.weaponCount,
        parallelLaunches: facts.parallelLaunches,
        requiresCompleteLaserGroup: facts.requiresCompleteLaserGroup,
      },
      connector: {
        env: agent.connectorEnv,
        connected: Boolean(process.env[agent.connectorEnv]),
      },
      generation: {
        mode: draft.generationMode || 'rules',
        aiAttempted: Boolean(aiAttempted),
        fallbackUsed: Boolean(fallbackUsed),
        model: draft.model || null,
        rationale: draft.aiRationale || '',
        rejectedAi: draft.rejectedAi || null,
      },
      learnedCriteria: learnedCriteria.filter((item) => item.platform === platform).length,
    };

    drafts.push(payload);
    agents.push({
      id: agent.id,
      platform,
      label: agent.label,
      mission: agent.mission,
      status: 'active',
      score: evaluation.score,
      decision: evaluation.summary,
      currentWork: draft.generationMode === 'openai'
        ? `Script genere par IA puis controle par ${criteria.length} criteres`
        : `Script regle metier controle par ${criteria.length} criteres`,
      socialSummary,
      criteriaChecked: criteria.length,
      connected: Boolean(process.env[agent.connectorEnv]),
      generationMode: draft.generationMode || 'rules',
      learnedCriteria: learnedCriteria.filter((item) => item.platform === platform).length,
    });

    suggestions.push({
      centerId: safeCenterId,
      agentId: agent.id,
      suggestionType: 'marketing_script',
      dedupeKey: `marketing:${safeCenterId}:${platform}:${runObjective}:${endDate}`,
      severity,
      confidence: evaluation.score / 100,
      title: draft.title,
      summary: evaluation.summary,
      payload,
    });

    if (persist) {
      await persistRunRow({
        centerId: safeCenterId,
        runId,
        runType,
        status: evaluation.blocked ? 'blocked' : 'finished',
        platform,
        agentId: agent.id,
        score: evaluation.score,
        summary: evaluation.summary,
        payload,
      });
    }
  }

  if (persist) {
    await saveAgentSuggestions(suggestions);
    await createOpsEvent({
      centerId: safeCenterId,
      eventType: 'marketing_agent_cycle',
      payload: {
        runId,
        runType,
        objective: runObjective,
        platforms: PLATFORM_ORDER,
        averageScore: Math.round(agents.reduce((sum, agent) => sum + agent.score, 0) / agents.length),
        blocked: agents.filter((agent) => agent.decision.toLowerCase().includes('bloque')).length,
        learnedCriteria: learnedCriteria.length,
      },
    });
  }

  return {
    ok: true,
    runId,
    centerId: safeCenterId,
    objective: runObjective,
    startDate,
    endDate,
    facts,
    signals,
    agents,
    drafts,
    learnedCriteria,
    summary: {
      averageScore: Math.round(agents.reduce((sum, agent) => sum + agent.score, 0) / agents.length),
      ready: agents.filter((agent) => agent.score >= 85).length,
      review: agents.filter((agent) => agent.score >= 70 && agent.score < 85).length,
      blocked: drafts.filter((draft) => draft.evaluation.blocked).length,
    },
  };
}

async function listLatestRuns(centerId) {
  await ensureMarketingSchema();
  const result = await getPool().query(
    `
      select *
      from marketing_agent_runs
      where center_id = $1
      order by created_at desc
      limit 30;
    `,
    [centerId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    centerId: row.center_id,
    runId: row.run_id,
    runType: row.run_type,
    status: row.status,
    platform: row.platform,
    agentId: row.agent_id,
    score: toNumber(row.score, 0),
    summary: row.summary,
    payload: row.payload || {},
    createdAt: row.created_at,
  }));
}

function buildMarketingAutonomyReport({ runs = [], suggestions = [], observations = [], agents = [] } = {}) {
  const readyRuns = runs.filter((run) => run.status !== 'blocked');
  const blockedRuns = runs.filter((run) => run.status === 'blocked');
  const criticalSuggestions = suggestions.filter((suggestion) => ['critical', 'high'].includes(suggestion.severity));
  const realPerformanceSignals = observations.filter((observation) => observation.source !== 'internal_playbook');
  const connectedSocial = agents.filter((agent) => agent.connected && agent.platform !== 'email').length;
  const connectedMail = agents.some((agent) => agent.connected && agent.platform === 'email');
  const openAiConnected = Boolean(process.env.OPENAI_API_KEY);
  const scoreParts = {
    database: AUTONOMY_WEIGHTS.database,
    scheduler: AUTONOMY_WEIGHTS.scheduler,
    guardrails: AUTONOMY_WEIGHTS.guardrails,
    generation: openAiConnected ? AUTONOMY_WEIGHTS.generation : Math.round(AUTONOMY_WEIGHTS.generation * 0.45),
    officialConnectors: Math.round((connectedSocial / 4) * 10) + (connectedMail ? 5 : 0),
    learningSignals: Math.min(AUTONOMY_WEIGHTS.learningSignals, Math.round(observations.length * 1.5)),
    recentActivity: Math.min(AUTONOMY_WEIGHTS.recentActivity, readyRuns.length * 2),
    lowRisk: blockedRuns.length || criticalSuggestions.length
      ? Math.max(0, AUTONOMY_WEIGHTS.lowRisk - blockedRuns.length - criticalSuggestions.length)
      : AUTONOMY_WEIGHTS.lowRisk,
  };
  const blockers = [];

  if (!openAiConnected) {
    blockers.push({
      level: 'important',
      title: 'Generation IA avancee non branchee',
      detail: 'OPENAI_API_KEY absent: le moteur reste fiable en deterministe, mais moins adaptable.',
    });
  }
  if (connectedSocial < 4) {
    blockers.push({
      level: 'important',
      title: 'Lecture reseaux sociaux incomplete',
      detail: 'Meta, TikTok ou LinkedIn ne sont pas tous connectes. Les agents apprennent avec les donnees internes et les feedbacks injectes.',
    });
  }
  if (!connectedMail) {
    blockers.push({
      level: 'medium',
      title: 'Canal email non operationnel',
      detail: 'RESEND_API_KEY absent ou non expose: les agents peuvent ecrire, mais pas envoyer via le canal officiel.',
    });
  }
  if (!realPerformanceSignals.length) {
    blockers.push({
      level: 'medium',
      title: 'Pas encore de performances reelles',
      detail: 'La base interne est active. Il manque encore les retours reels de posts pour prouver ce qui marche sur chaque reseau.',
    });
  }
  if (blockedRuns.length || criticalSuggestions.length) {
    blockers.push({
      level: 'high',
      title: 'Scripts a corriger',
      detail: `${blockedRuns.length} run(s) bloques, ${criticalSuggestions.length} suggestion(s) critique(s) ou haut risque.`,
    });
  }

  const score = clamp(Object.values(scoreParts).reduce((sum, value) => sum + value, 0), 0, 100);
  return {
    score,
    scoreParts,
    label: score >= 90 ? 'Production surveillee' : score >= 75 ? 'Solide, connecteur externe manquant' : 'Base active, preuves manquantes',
    blockers,
    capabilities: {
      deterministicGuardrails: true,
      openAiConnected,
      connectedSocial,
      connectedMail,
      persistedLearning: observations.length > 0,
      realPerformanceSignals: realPerformanceSignals.length,
      lastRunAt: runs[0]?.createdAt || null,
    },
  };
}

async function getMarketingAgentStatus({ centerId = 'libramont' } = {}) {
  const safeCenterId = normalizeCenterId(centerId);
  await ensureMarketingSchema();
  await ensureDefaultCriteria(safeCenterId);
  await ensureMarketingPlaybookSignals(safeCenterId);
  const [runs, suggestions, observations] = await Promise.all([
    listLatestRuns(safeCenterId),
    listAgentSuggestions({ centerId: safeCenterId, status: 'pending', limit: 100 }),
    loadSocialObservations(safeCenterId),
  ]);
  const marketingSuggestions = suggestions.filter((suggestion) => suggestion.suggestionType === 'marketing_script');
  const latestByPlatform = new Map();
  for (const run of runs) {
    if (!latestByPlatform.has(run.platform)) latestByPlatform.set(run.platform, run);
  }

  const agents = getMarketingPlatforms().map((agent) => {
    const latest = latestByPlatform.get(agent.platform);
    return {
      ...agent,
      status: 'active',
      score: latest ? latest.score : null,
      currentWork: latest ? latest.summary : 'Surveillance des donnees centre.',
      lastRunAt: latest?.createdAt || null,
      socialSummary: socialSignalSummary(agent.platform, observations),
      criteriaChecked: latest?.payload?.evaluation?.checks?.length || defaultCriteriaFor(agent.platform).length,
      generationMode: latest?.payload?.generation?.mode || 'rules',
      learnedCriteria: latest?.payload?.learnedCriteria || 0,
    };
  });
  const autonomy = buildMarketingAutonomyReport({ runs, suggestions: marketingSuggestions, observations, agents });

  return {
    ok: true,
    centerId: safeCenterId,
    scheduler: {
      status: 'active',
      mode: 'vercel-cron-and-manual',
      cadence: 'cron ops production + lancement manuel',
      note: 'Les agents analysent sans publier. Publication et lecture reseaux externes necessitent les connecteurs officiels.',
    },
    agents,
    autonomy,
    runs,
    observations,
    suggestions: marketingSuggestions,
    metrics: {
      runs: runs.length,
      pendingScripts: marketingSuggestions.length,
      learnedSignals: observations.length,
      externalSignals: observations.filter((observation) => observation.source !== 'internal_playbook').length,
      connectedAgents: agents.filter((agent) => agent.connected).length,
    },
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildCenterFacts,
  buildDraftForPlatform,
  buildSignalPack,
  defaultCriteriaFor,
  getMarketingAgentStatus,
  getMarketingPlatforms,
  recordMarketingFeedback,
  runMarketingAgentCycle,
  scoreDraft,
};
