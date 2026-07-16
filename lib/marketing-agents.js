const {
  createOpsEvent,
  getPool,
  listAgentSuggestions,
  listOpsEvents,
  readAdminRangeState,
  saveAgentSuggestions,
} = require('./database');
const { loadOpsKnowledge } = require('./ops-knowledge');
const {
  FUN_GALAXY_BRAND,
  composeChannelDraft,
  focusActivityNames,
  listOccasions,
  pickSeasonalHook,
  resolveOccasion,
} = require('./fungalaxy-brand');
const {
  buildDataFactsBundle,
  measureAppliedInsights,
  aggregateMarketingPatterns,
  runDataIdeasCycle,
} = require('./center-metrics');
const { llmProvider, callLlmJson } = require('./llm-client');

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
// Le seeding des criteres par defaut et des signaux playbook est idempotent et
// statique (constantes). On le rejoue une seule fois par centre et par instance
// (warm), au lieu de reupsert ~35 lignes a chaque appel de cycle/status.
const seededCriteriaCenters = new Set();
const seededPlaybookCenters = new Set();

// Cache memoire court par centre: evite de recalculer un cycle/status complet
// pour des appels rapproches (rafraichissements UI, double centre). Fail-soft:
// une entree expiree ou absente declenche simplement un recalcul.
const MARKETING_CACHE_TTL_MS = 45000;
const statusCache = new Map();
const cycleCache = new Map();
function cacheGet(store, key) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) store.delete(key);
  return null;
}
function cacheSet(store, key, value) {
  store.set(key, { expires: Date.now() + MARKETING_CACHE_TTL_MS, value });
}
function invalidateMarketingCache(centerId) {
  statusCache.delete(centerId);
  for (const key of cycleCache.keys()) {
    if (key.startsWith(`${centerId}|`)) cycleCache.delete(key);
  }
}

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
    // Verrou TRANSACTIONNEL (pas session) : auto-relâché au commit/rollback ET
    // si le lambda meurt (timeout Vercel). L'ancien pg_advisory_lock de session
    // restait coincé sur la connexion poolée quand un run timeoutait au milieu
    // du schéma → tous les cycles suivants bloquaient dessus (hang 100s+ → 504).
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['marketing_agent_schema_v1']);
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
    await client.query('commit');
    marketingSchemaReady = true;
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

function getKnowledgeCenter(centerId = 'libramont', knowledge = loadOpsKnowledge()) {
  return (knowledge.centers || []).find((center) => center.id === centerId)
    || (knowledge.centers || []).find((center) => center.id === 'libramont')
    || {};
}

// Nom PUBLIC d'une activité. Repli sur l'ADN de marque puis, en dernier
// recours, sur un id rendu lisible : un identifiant brut (« fun_run ») ne doit
// JAMAIS finir dans un post.
function getActivityName(activityId, knowledge = loadOpsKnowledge()) {
  const activity = (knowledge.activities || []).find((item) => item.id === activityId);
  if (activity?.name) return activity.name;
  const brand = (FUN_GALAXY_BRAND.activities || {})[activityId];
  if (brand?.name) return brand.name;
  return String(activityId || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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

  // GARDE-FOU DUR : tout ce que CE centre n'a pas devient une interdiction.
  // Le contenu qui le mentionne est bloqué par le scorer (center_truth = 0).
  // Vérité terrain (formulaire de réservation fungalaxy.be, 2026-07-16) :
  // Libramont = 8 activités, Gembloux = 6. Karting VR, Free Roaming VR, lancer
  // de hache et fléchettes n'existent dans AUCUN centre. Écrit sans accents :
  // le matching passe par normalize() (stripAccents + minuscules).
  const CLAIM_WORDS_BY_ACTIVITY = {
    golf_oclock: ["golf o'clock", 'golf oclock'],
    karting_vr: ['karting vr', 'karting'],
    free_roaming_vr: ['free roaming', 'realite virtuelle', 'vr immersive'],
    axe_throwing: ['lancer de hache', 'lancer de haches', 'hache'],
    darts: ['lancer de flechettes', 'flechettes'],
    duckpin_bowling: ['duckpin'],
    playground: ['plaine de jeux', 'playground'],
    fun_run: ['fun run'],
    minigolf_blacklight: ['minigolf blacklight'],
    billards: ['billard'],
  };
  for (const [activityId, words] of Object.entries(CLAIM_WORDS_BY_ACTIVITY)) {
    if (availability[activityId]) continue;
    forbiddenClaims.push(...words);
  }

  const themes = center.activityThemes || {};
  const publicProof = center.publicProof || {};
  const groupProof = (knowledge && knowledge.groupProof) || {};

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
    // Le matériau différenciant réel de CE centre (thème du laser, du minigolf,
    // surfaces, capacités). Ex : Urban Guerilla 500 m2 a Libramont vs Star Wars
    // 370 m2 a Gembloux. C'est ce qui rend un post specifique plutot que generique.
    themes,
    // Preuve publique DE CE CENTRE uniquement. Libramont n'a aucune note
    // publiee : googleRating reste null et aucune note ne doit sortir.
    googleRating: publicProof.googleRating || null,
    googleReviews: publicProof.googleReviews || null,
    groupProof,
    publicInfo: center.publicInfo || {},
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
    // Faits data du warehouse quotidien (météo x fréquentation contrôlée,
    // prévision J+7, congés FWB, événements locaux). Optionnel : null tant que
    // le warehouse n'est pas alimenté : les consommateurs doivent le tolérer.
    dataFacts: context.dataFacts || null,
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

// Affinite occasion x canal. Chaque canal a un ordre de preference d'occasions
// ancre dans son audience naturelle (Facebook = familles/anniversaires,
// LinkedIn = teambuilding/ecoles...). Sert a diversifier un cycle: au lieu de
// generer 5 fois la meme occasion, chaque canal traite l'occasion qui lui va le
// mieux et qui n'est pas deja prise par un autre canal.
const PLATFORM_OCCASION_AFFINITY = {
  facebook: ['anniversaire_enfant', 'family_day', 'creneau_calme', 'formules_decouverte'],
  instagram: ['anniversaire_ado', 'sortie_amis', 'evjf_evg', 'formules_decouverte'],
  tiktok: ['sortie_amis', 'anniversaire_ado', 'evjf_evg', 'formules_decouverte'],
  linkedin: ['teambuilding', 'journee_scolaire', 'family_day'],
  email: ['creneau_calme', 'formules_decouverte', 'anniversaire_enfant', 'teambuilding'],
};

// Occasions rendues prioritaires par les VRAIS signaux de reservation de la
// periode (groupes -> teambuilding, formules -> formules, laser -> sortie amis,
// creux -> creneau calme) plus la saison. Base sur signals issus des collecteurs.
function signalPriorityOccasions(signals = {}) {
  const out = [];
  const byType = signals.byType || {};
  if (toNumber(signals.groups, 0) >= 1) out.push('teambuilding');
  if (toNumber(signals.formulas, 0) >= 1 || toNumber(byType.formule, 0) >= 1) out.push('formules_decouverte');
  if (toNumber(byType.laser, 0) >= 1) out.push('sortie_amis');
  if (signals.quiet) out.push('creneau_calme');
  const season = pickSeasonalHook();
  (season.focus || []).forEach((id) => out.push(id));
  return [...new Set(out)];
}

// Assigne a chaque canal une occasion DISTINCTE. L'objectif explicite (si fourni)
// occupe son canal d'affinite le plus naturel; les signaux reels biaisent le
// reste; le reliquat suit l'affinite du canal. Garantit une vraie variete de
// contenus (5 occasions differentes) plutot que 5 variantes du meme hook.
function assignPlatformOccasions(signals = {}, objective = '') {
  const requested = normalizeText(objective) ? resolveOccasion(objective).id : '';
  const priority = signalPriorityOccasions(signals);
  const allIds = listOccasions().map((occasion) => occasion.id);
  const used = new Set();
  const map = {};
  if (requested) {
    const host = PLATFORM_ORDER.find((platform) => PLATFORM_OCCASION_AFFINITY[platform].includes(requested))
      || PLATFORM_ORDER[0];
    map[host] = requested;
    used.add(requested);
  }
  for (const platform of PLATFORM_ORDER) {
    if (map[platform]) continue;
    const prefs = [
      ...priority.filter((id) => PLATFORM_OCCASION_AFFINITY[platform].includes(id)),
      ...PLATFORM_OCCASION_AFFINITY[platform],
      ...priority,
      ...allIds,
    ];
    const pick = prefs.find((id) => !used.has(id)) || prefs[0];
    map[platform] = pick;
    used.add(pick);
  }
  return map;
}

function defaultCriteriaFor(platform) {
  return [...BASE_CRITERIA, ...(PLATFORM_CRITERIA[platform] || [])];
}

async function ensureDefaultCriteria(centerId) {
  if (seededCriteriaCenters.has(centerId)) return;
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
    seededCriteriaCenters.add(centerId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureMarketingPlaybookSignals(centerId) {
  if (seededPlaybookCenters.has(centerId)) return;
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
  if (Number(existing.rows[0]?.count || 0) >= PLATFORM_ORDER.length) {
    seededPlaybookCenters.add(centerId);
    return;
  }

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
    seededPlaybookCenters.add(centerId);
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

// Charge les criteres de TOUTES les plateformes en une seule requete et les
// regroupe par plateforme. Remplace 5 appels loadCriteriaRows (5 SELECT + 5
// ensureDefaultCriteria) par 1 seul aller-retour DB dans un cycle.
async function loadAllCriteriaRows(centerId) {
  await ensureDefaultCriteria(centerId);
  const result = await getPool().query(
    `
      select platform, criterion_id, label, description, weight, evidence
      from marketing_agent_criteria
      where center_id = $1
      order by platform asc, id asc;
    `,
    [centerId],
  );
  const byPlatform = new Map(PLATFORM_ORDER.map((platform) => [platform, []]));
  for (const row of result.rows) {
    if (!byPlatform.has(row.platform)) byPlatform.set(row.platform, []);
    byPlatform.get(row.platform).push({
      id: row.criterion_id,
      label: row.label,
      description: row.description,
      weight: toNumber(row.weight, 1),
      evidence: row.evidence || {},
    });
  }
  return byPlatform;
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

// Construit le brief de marque riche injecte dans le prompt IA. Meme ADN que
// le chemin deterministe: quand une cle IA est ajoutee (ANTHROPIC_API_KEY ou
// OPENAI_API_KEY), l'IA est nourrie du ton, des activites reelles, de
// l'occasion ciblee et des preuves.
function buildBrandBrief(occasion, facts = {}) {
  return {
    marque: FUN_GALAXY_BRAND.identity.name,
    signature: FUN_GALAXY_BRAND.identity.tagline,
    mission: FUN_GALAXY_BRAND.identity.mission,
    ton: FUN_GALAXY_BRAND.identity.voice,
    motsSignature: FUN_GALAXY_BRAND.identity.signatureWords,
    differenciateurs: FUN_GALAXY_BRAND.identity.differentiators,
    preuve: FUN_GALAXY_BRAND.proof,
    occasion: occasion
      ? {
          id: occasion.id,
          label: occasion.label,
          audience: occasion.audience,
          angle: occasion.angle,
          promesse: occasion.promise,
          benefices: occasion.benefits,
          accrocheEmotionnelle: occasion.emotionalHook,
          urgence: occasion.urgency,
          creneaux: occasion.bestSlots,
        }
      : null,
    activitesDisponibles: focusActivityNames(occasion || {}, facts),
    saison: pickSeasonalHook().hook,
  };
}

async function callAiMarketingAgent({ platform, facts, signals, objective, brief, observations, occasion }) {
  if (!llmProvider()) return null;
  const targetOccasion = occasion || resolveOccasion(objective);
  const brandBrief = buildBrandBrief(targetOccasion, facts);
  // Bloc système STABLE (identique à chaque appel, toutes plateformes) →
  // prompt caching Anthropic. Le bloc CANAL (règles + exemple canonique) varie
  // par plateforme : il part côté user pour ne pas casser le cache du stable.
  const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
  const stableSystem = [
    `Tu es le copywriter senior de Fun Galaxy (centres de loisirs indoor belges : bowling, laser game, arcades). Signature de marque : "${FUN_GALAXY_BRAND.identity.tagline}".`,
    'INTERDITS PRODUIT (au-dessus de tout) : jamais inventer une activite, une disponibilite, une promotion, un prix, une session dediee ou une promesse garantie. Uniquement les faits fournis dans brandDNA et centerFacts.',
    COPY_SYSTEM_CORE,
    'Reponds uniquement en JSON conforme au schema.',
  ].join('\n\n');
  const result = await callLlmJson({
    stableSystem,
    user: JSON.stringify({
      platform,
      objective,
      brief,
      brandDNA: brandBrief,
      centerFacts: facts,
      internalSignals: signals,
      socialSignals: (observations || []).slice(0, 12),
      canal: channelPlaybook(platform),
      outputRules: [
        'Le texte doit etre directement publiable ou copiable.',
        'Les chiffres des exemples canoniques sont un ADN d\'ecriture, PAS des faits : tes chiffres a toi viennent exclusivement de brandDNA/centerFacts.',
        'Mentionner le centre exact (sa ville) et au moins une activite reellement disponible.',
        'Preuve : utiliser UNIQUEMENT celle presente dans centerFacts (note publiee de CE centre, capacite, chiffres du groupe). Si aucune note n\'y figure, n\'en citer aucune : ne jamais transporter la note d\'un centre vers l\'autre.',
        'Ne citer que les activites presentes dans centerFacts.activites : les deux centres n\'ont PAS le meme contenu.',
        'Ne pas promettre de session Laser Game dediee ni de disponibilite garantie.',
        COPY_FINAL_REMINDER,
      ],
    }),
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
    schemaName: 'fun_galaxy_marketing_script',
    maxTokens: 1200,
    timeoutMs: 14000,
    openaiModel: getOpenAiMarketingModel(),
  });
  if (!result || !result.body || typeof result.body !== 'string') return null;
  return {
    platform,
    channel: platform,
    occasion: targetOccasion?.id || null,
    occasionLabel: targetOccasion?.label || '',
    audience: targetOccasion?.audience || 'public',
    hook: targetOccasion?.emotionalHook || '',
    benefits: targetOccasion?.benefits || [],
    title: normalizeText(result.title, `Script ${platform} - ${facts.centerName}`),
    body: result.body.trim(),
    aiRationale: normalizeText(result.rationale),
    aiKeywords: Array.isArray(result.keywords) ? result.keywords.map((item) => normalizeText(item)).filter(Boolean) : [],
    keywords: Array.isArray(result.keywords) ? result.keywords.map((item) => normalizeText(item)).filter(Boolean) : [],
    generationMode: result._provider,
    model: result._model,
  };
}

// LA doctrine d'acceptation IA, unique pour les deux chemins (defaut F de
// l'audit) : l'IA est l'AUTEUR, le template n'est qu'un FILET. Le scorer est
// heuristique et taille pour le template (meme codebase) : exiger que l'IA le
// batte revenait a ne jamais publier ce qu'elle ecrit (constate en reel :
// rules 87 vs ai 86). La barre est ABSOLUE et partagee avec le Studio.
const MIN_ACCEPTED_SCORE = 82;

async function buildBestDraftForPlatform({ platform, facts, signals, objective, brief, observations, criteria }) {
  const occasion = resolveOccasion(chooseObjective(signals, objective));
  const templateDraft = {
    ...buildDraftForPlatform({ platform, facts, signals, objective, brief }),
    generationMode: 'rules',
  };
  const templateScore = scoreDraft({ text: templateDraft.body, platform, facts, signals, criteria });
  const aiDraft = await callAiMarketingAgent({ platform, facts, signals, objective, brief, observations, occasion });
  const aiAttempted = Boolean(llmProvider());
  if (!aiDraft) return { draft: templateDraft, evaluation: templateScore, fallbackUsed: false, aiAttempted };
  const aiScore = scoreDraft({ text: aiDraft.body, platform, facts, signals, criteria });
  if (!aiScore.blocked && aiScore.score >= MIN_ACCEPTED_SCORE) {
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

// Calcul PUR (sans I/O) d'une ligne de critere apprise depuis une observation.
// Retourne null quand l'observation n'a aucun signal exploitable (skip).
function computeLearnedCriterionRow({ centerId, platform, source = 'manual', signalType, payload = {} }) {
  const keywords = extractObservationKeywords(payload);
  if (!keywords.length && !normalizeText(payload?.notes) && !normalizeText(payload?.caption)) {
    return null;
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
  return {
    centerId,
    platform,
    criterionId,
    label: `Signal observe: ${main}`,
    description: 'Critere appris depuis un signal ou une performance reseau social.',
    weight,
    evidence: {
      source,
      signalType,
      keywords,
      lastPayload: payload,
      lastSeen: new Date().toISOString(),
    },
    keywords,
  };
}

// Upsert multi-lignes des criteres appris. Un seul aller-retour DB quel que soit
// le nombre de signaux (au lieu d'un INSERT par observation x plateforme).
async function batchUpsertCriteria(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const row of rows) {
    values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++}::jsonb,now())`);
    params.push(
      row.centerId,
      row.platform,
      row.criterionId,
      row.label,
      row.description,
      row.weight,
      JSON.stringify(row.evidence),
    );
  }
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
      ) values ${values.join(',')}
      on conflict (center_id, platform, criterion_id)
      do update set
        label = excluded.label,
        description = excluded.description,
        weight = greatest(marketing_agent_criteria.weight, excluded.weight),
        evidence = marketing_agent_criteria.evidence || excluded.evidence,
        updated_at = now();
    `,
    params,
  );
}

async function learnCriteriaFromObservation({ centerId, platform, source = 'manual', signalType, payload }) {
  const row = computeLearnedCriterionRow({ centerId, platform, source, signalType, payload });
  if (!row) {
    return { criterionId: null, keywords: [], weight: 0, skipped: true };
  }
  await batchUpsertCriteria([row]);
  return { criterionId: row.criterionId, keywords: row.keywords, weight: row.weight };
}

async function learnCriteriaFromObservations(centerId, observations = []) {
  const learned = [];
  // Deduplication par (plateforme, criterion_id): Postgres refuse deux lignes
  // avec la meme cible de conflit dans un seul INSERT. On garde le poids le plus
  // fort (meme semantique que `greatest` de l'upsert sequentiel d'origine).
  const upserts = new Map();
  for (const observation of observations.slice(0, 30)) {
    const platforms = observation.platform === 'all' ? PLATFORM_ORDER : [observation.platform];
    for (const platform of platforms.filter((item) => PLATFORM_ORDER.includes(item))) {
      const row = computeLearnedCriterionRow({
        centerId,
        platform,
        source: observation.source || 'observation',
        signalType: observation.signalType || observation.signal_type || 'benchmark',
        payload: observation.payload || {},
      });
      if (!row) continue;
      learned.push({ platform, criterionId: row.criterionId, keywords: row.keywords, weight: row.weight });
      const key = `${platform}|${row.criterionId}`;
      const prev = upserts.get(key);
      if (!prev || row.weight > prev.weight) upserts.set(key, row);
    }
  }
  await batchUpsertCriteria([...upserts.values()]);
  return learned;
}

// Canal de sortie par plateforme. Les 5 plateformes historiques mappent 1:1
// vers un canal de marque; SMS et promo sont accessibles via composeChannelDraft
// directement (canaux additionnels exposes a la couche strategique).
const PLATFORM_TO_CHANNEL = {
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  email: 'email',
};

// Delegue au compositeur ADN Fun Galaxy (lib/fungalaxy-brand.js). L'objectif
// libre est resolu en occasion (anniversaire, teambuilding, EVJF...) puis
// decline par canal a l'ADN reel de la marque. Garde la meme signature et le
// meme contrat de sortie ({ platform, title, body, ... }) que l'ancien moteur.
function buildDraftForPlatform({
  platform = 'facebook',
  facts = buildCenterFacts(),
  signals = buildSignalPack(),
  objective = '',
  brief = '',
  audience = '',
} = {}) {
  const channel = PLATFORM_TO_CHANNEL[platform] || 'facebook';
  const safeObjective = chooseObjective(signals, objective);
  const occasion = resolveOccasion(safeObjective);
  const draftAudience = normalizeText(audience) || occasion.audience || 'public';
  const composed = composeChannelDraft({
    channel,
    facts,
    signals,
    occasion,
    audience: draftAudience,
    brief,
  });
  return {
    ...composed,
    platform: channel,
    objective: safeObjective,
  };
}

// Variantes multi-audience pour un meme couple occasion x canal. Permet a l'UI
// de proposer plusieurs angles (parents, entreprise, ecole, grand public) sans
// relancer le moteur.
function buildDraftVariants({ platform = 'facebook', facts, signals, objective = '', brief = '' } = {}) {
  const channel = PLATFORM_TO_CHANNEL[platform] || 'facebook';
  const occasion = resolveOccasion(chooseObjective(signals, objective));
  const audiences = [...new Set([occasion.audience || 'public', 'particulier', 'entreprise'])].slice(0, 3);
  return audiences.map((audience) => {
    const composed = composeChannelDraft({ channel, facts, signals, occasion, audience, brief });
    return {
      audience,
      audienceLabel: FUN_GALAXY_BRAND.audiences[audience]?.label || audience,
      title: composed.title,
      body: composed.body,
      cta: composed.cta,
    };
  });
}

function forbiddenHits(text, facts) {
  const normalized = lower(text);
  return (facts.forbiddenClaims || []).filter((claim) => normalized.includes(lower(claim)));
}

// ── Grounding des chiffres (defaut C de l'audit) ────────────────────────────
// L'ancien scorer donnait +20 points a N'IMPORTE QUEL chiffre (hasNumbers =
// /\d/) : mettre un chiffre invente rapportait des points, et aucun motif
// prix/promo n'etait bloque. Un « -20% avant 17h » totalement invente sortait
// etiquete ready. Ici : (1) seuls les chiffres PRESENTS dans les faits du
// centre (ou les donnees mesurees du jour) creditent proof_from_data ;
// (2) tout motif prix/promo dont le chiffre n'est pas un fait BLOQUE le
// draft, exactement comme un claim d'activite absente.

// Tokens numeriques normalises d'un texte : virgule -> point, puis forme
// canonique (« 12,50 » et « 12.5 » donnent le meme token « 12.5 »).
function extractNumericTokens(text) {
  const matches = String(text || '').match(/\d+(?:[.,]\d+)?/g) || [];
  return matches.map((token) => String(parseFloat(token.replace(',', '.'))));
}

// L'ensemble des chiffres que le centre peut prouver : tout nombre present
// dans centerFacts (pistes, armes, note publiee, themes « 500 m2 », prix
// reellement affiches dans publicInfo, chiffres du groupe) et dans les
// donnees mesurees passees en signaux (meteo prevue, frequentation). Parcours
// recursif borne : les faits sont des objets courts.
// Les faits SANS la liste d'interdits : forbiddenClaims contient des tournures
// a bannir (« 100% disponible », « reduction garantie ») qui ne sont PAS des
// faits du centre. Les laisser dans la matiere factuelle rendrait « 100 » ou
// « reduction » fondes, exactement l'inverse du but.
function factsWithoutForbidden(facts = {}) {
  const { forbiddenClaims, ...rest } = facts;
  return rest;
}

function collectFactNumbers(facts = {}, signals = {}) {
  const found = new Set();
  const visit = (value, depth) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      for (const token of extractNumericTokens(String(value))) found.add(token);
      return;
    }
    if (typeof value === 'string') {
      for (const token of extractNumericTokens(value)) found.add(token);
      return;
    }
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) visit(item, depth + 1); return; }
    if (typeof value === 'object') { for (const item of Object.values(value).slice(0, 50)) visit(item, depth + 1); }
  };
  visit(factsWithoutForbidden(facts), 0);
  visit(signals.dataFacts || null, 0);
  visit({ reservations: signals.reservationCount, players: signals.players, groups: signals.groups }, 0);
  return found;
}

// Les motifs prix/promo du texte dont la valeur n'est PAS un fait du centre.
// Motifs couverts : pourcentages (« -20% »), montants (« 12 € », « 12 euros »),
// et mots d'offre (promo, reduction, remise, offert, gratuit) : une offre, ca
// se decide par le gerant, ca ne s'invente pas par le modele.
//
// Grounding STRICT par nature de claim : un pourcentage n'est fonde que par un
// fait qui porte un pourcentage, un prix que par un fait-prix (motif « € »
// dans un texte de fait, ou champ numerique nomme price/prix/tarif comme
// pricePerPerson). Le simple fait que le nombre « 20 » existe quelque part
// dans les faits (un horaire, une capacite) ne fonde JAMAIS un « -20% ».
const OFFER_WORDS = ['promo', 'promotion', 'reduction', 'remise', 'offert', 'offerte', 'gratuit', 'gratuite'];
const PRICE_KEY_RX = /price|prix|tarif|euro/i;
const PERCENT_RX = /\d+(?:[.,]\d+)?\s?%/g;
const EURO_RX = /\d+(?:[.,]\d+)?\s?(?:€|eur(?:os?)?\b)/gi;

// Les valeurs prix/pourcentage que les faits du centre peuvent prouver.
function collectFactPriceTokens(facts = {}) {
  const percents = new Set();
  const euros = new Set();
  const visit = (value, key, depth) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (PRICE_KEY_RX.test(String(key || ''))) euros.add(String(value));
      return;
    }
    if (typeof value === 'string') {
      for (const match of value.match(PERCENT_RX) || []) percents.add(extractNumericTokens(match)[0]);
      for (const match of value.match(EURO_RX) || []) euros.add(extractNumericTokens(match)[0]);
      if (PRICE_KEY_RX.test(String(key || ''))) {
        for (const token of extractNumericTokens(value)) euros.add(token);
      }
      return;
    }
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) visit(item, key, depth + 1); return; }
    if (typeof value === 'object') {
      for (const [childKey, item] of Object.entries(value).slice(0, 50)) visit(item, childKey, depth + 1);
    }
  };
  visit(factsWithoutForbidden(facts), '', 0);
  return { percents, euros };
}

function ungroundedPriceClaims(text, facts = {}, signals = {}) {
  const raw = String(text || '');
  if (!raw) return [];
  const normalized = lower(raw);
  const { percents, euros } = collectFactPriceTokens(facts);
  const factText = lower(JSON.stringify(factsWithoutForbidden(facts)));
  const claims = [];

  for (const match of raw.match(PERCENT_RX) || []) {
    const token = extractNumericTokens(match)[0] || '';
    if (!percents.has(token)) claims.push(`pourcentage invente: ${match.trim()}`);
  }

  for (const match of raw.match(EURO_RX) || []) {
    const token = extractNumericTokens(match)[0] || '';
    if (!euros.has(token)) claims.push(`prix invente: ${match.trim()}`);
  }

  for (const word of OFFER_WORDS) {
    if (normalized.includes(word) && !factText.includes(word)) {
      claims.push(`offre non decidee par le centre: ${word}`);
    }
  }

  return [...new Set(claims)];
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
    // Note graduee: plus le texte nomme d'audiences concretes, meilleur le score.
    const words = ['famille', 'anniversaire', 'groupe', 'ecole', 'equipe', 'club', 'amis', 'enfants', 'parents', 'collegues'];
    const matches = words.filter((word) => normalized.includes(word)).length;
    return {
      score: matches ? clamp(60 + matches * 12, 60, 96) : 52,
      note: matches ? `${matches} signal(aux) d'audience concrete.` : 'Audience pas assez concrete.',
    };
  }
  if (criterion.id === 'proof_from_data') {
    // La note du centre COURANT seulement. On ne récompense plus le littéral
    // « 4.8 » : c'est la note de Gembloux, et la récompenser poussait Libramont
    // (qui n'a AUCUNE note publiée) à s'attribuer la réputation d'un autre
    // centre. Et un chiffre n'est une PREUVE que s'il vient des faits du
    // centre (défaut C : « n'importe quel chiffre » rapportait 20 points, donc
    // le scorer récompensait l'invention). Un chiffre non fondé ne crédite
    // RIEN : il est traité comme absence de preuve.
    const centerRating = Number(facts.googleRating) || 0;
    const hasRating = centerRating > 0 && new RegExp(String(centerRating).replace('.', '[.,]')).test(text);
    const factNumbers = collectFactNumbers(facts, signals);
    const textNumbers = extractNumericTokens(text);
    const groundedNumbers = textNumbers.filter((token) => factNumbers.has(token));
    const hasGroundedNumber = groundedNumbers.length > 0;
    const hasReservationProof = signals.reservationCount > 0 && normalized.includes('reservation');
    let score = 58;
    if (hasGroundedNumber) score = 78;
    if (hasRating) score = 88;
    if ((hasRating || hasGroundedNumber) && hasReservationProof) score = 95;
    return {
      score,
      note: hasRating
        ? 'Preuve chiffree (note publiee de ce centre).'
        : hasGroundedNumber
          ? `Chiffre fonde sur les faits du centre (${groundedNumbers.slice(0, 3).join(', ')}).`
          : textNumbers.length
            ? 'Chiffre present mais absent des faits du centre : aucun credit.'
            : 'Ajouter un signal concret.',
    };
  }
  if (criterion.id === 'clear_cta') {
    // Note graduee: verbes d'action multiples + mention d'une dispo renforcent le CTA.
    const verbs = ['demandez', 'demande', 'reserve', 'reservez', 'envoyez', 'contactez', 'ramene'];
    const matches = verbs.filter((word) => normalized.includes(word)).length;
    const hasDispo = normalized.includes('dispo');
    return {
      score: matches ? clamp(74 + matches * 8 + (hasDispo ? 6 : 0), 74, 96) : 54,
      note: matches ? 'Action claire.' : 'CTA faible.',
    };
  }
  if (criterion.id === 'readability') {
    // Note graduee selon le nombre de lignes longues (penalite progressive).
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const longLines = lines.filter((line) => line.length > 170).length;
    const veryLongLines = lines.filter((line) => line.length > 240).length;
    return {
      score: clamp(96 - longLines * 7 - veryLongLines * 6, 66, 96),
      note: longLines ? `${longLines} ligne(s) trop longue(s).` : 'Lecture fluide.',
    };
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
  // Un prix/promo dont le chiffre n'est pas un fait du centre bloque comme un
  // claim d'activite absente : c'est le scenario « l'IA promet une promo que
  // le client n'a jamais decidee » (defaut C de l'audit).
  const priceClaims = ungroundedPriceClaims(text, facts, signals);
  const blockers = [...hits, ...priceClaims];
  const rawScore = weightedTotal / weightTotal;
  const score = blockers.length ? Math.min(rawScore, 35) : rawScore;
  return {
    score: Math.round(score),
    status: blockers.length ? 'blocked' : score >= 85 ? 'ready' : score >= 70 ? 'review' : 'needs_work',
    blocked: blockers.length > 0,
    forbiddenHits: hits,
    priceClaims,
    checks,
    summary: blockers.length
      ? `Bloque: ${blockers.join(', ')}`
      : score >= 85
        ? 'Script utilisable apres relecture humaine rapide.'
        : 'Script a ameliorer avant utilisation.',
  };
}

// Traduit un critere de scoring faible en amelioration concrete a appliquer.
const CRITERION_FIX_HINTS = {
  center_truth: 'Retirer toute activite absente du centre; ne garder que les activites reellement disponibles.',
  human_resonance: 'Nommer explicitement l\'audience (parents, groupe, equipe, ecole ou amis) des la premiere ligne.',
  proof_from_data: 'Ajouter une preuve chiffree venue des faits de CE centre : sa note publiee si elle existe, sinon une capacite, une duree, un prix ou un nombre de reservations.',
  clear_cta: 'Terminer par un appel a action net (Demandez une dispo, Reservez votre date).',
  readability: 'Raccourcir les phrases trop longues et aerer en lignes courtes.',
  risk_guardrail: 'Supprimer toute promesse de disponibilite ou de session dediee garantie.',
  facebook_local: 'Citer la ville du centre pour ancrer le message localement.',
  instagram_visual: 'Ajouter un brief de tournage concret (a filmer: arrivee, activite, moment fort).',
  tiktok_hook: 'Poser un hook clair et un plan 1 filmable des les premieres secondes.',
  linkedin_business: 'Renforcer l\'angle B2B: equipe, ecole, entreprise ou club.',
  email_human: 'Ouvrir par Bonjour et signer au nom de Fun Galaxy pour un ton humain.',
};

// Couche strategique "mieux qu'une agence": a partir de l'ADN, des faits du
// centre et des signaux (reservations/occasions), produit une analyse de gap,
// un calendrier editorial et des ameliorations concretes sur le contenu genere.
function buildMarketingStrategy({ facts = {}, signals = {}, drafts = [], observations = [], now = new Date() } = {}) {
  const season = pickSeasonalHook(now);
  const groups = Number(signals.groups) || 0;
  const formulas = Number(signals.formulas) || Number(signals.byType?.formule) || 0;
  const laserCount = Number(signals.byType?.laser) || 0;
  const quiet = Boolean(signals.quiet);
  const coveredOccasions = new Set(drafts.map((draft) => draft.occasion).filter(Boolean));

  const gapAnalysis = listOccasions().map((occasion) => {
    let status = 'opportunite';
    let insight = 'Occasion non encore travaillee sur la periode.';
    if (coveredOccasions.has(occasion.id)) {
      status = 'couvert';
      insight = 'Script genere sur cette occasion lors du dernier cycle.';
    } else if (occasion.id === 'teambuilding' && groups >= 1) {
      status = 'a-renforcer';
      insight = `${groups} groupe(s) detecte(s): l'angle entreprise/teambuilding est porteur.`;
    } else if (occasion.id === 'formules_decouverte' && formulas >= 1) {
      status = 'a-renforcer';
      insight = `${formulas} formule(s) reservee(s): capitaliser sur les combinaisons d'activites.`;
    } else if (occasion.id === 'sortie_amis' && laserCount >= 1) {
      status = 'a-renforcer';
      insight = `Laser Game demande (${laserCount}): l'angle sortie entre amis convertit.`;
    } else if (occasion.id === 'creneau_calme' && quiet) {
      status = 'a-renforcer';
      insight = 'Periode calme detectee: pousser les creneaux tranquilles remplit les creux.';
    }
    if (season.focus?.includes(occasion.id) && status === 'opportunite') {
      status = 'a-renforcer';
      insight = `Occasion de saison (${season.hook}).`;
    }
    return {
      occasion: occasion.id,
      label: occasion.label,
      audience: occasion.audience,
      status,
      insight,
      recommendation: `${occasion.angle} CTA type: ${occasion.cta?.default || occasion.cta?.public || 'demander une dispo'}.`,
      bestSlots: occasion.bestSlots || [],
      priority: status === 'a-renforcer' ? 1 : status === 'opportunite' ? 2 : 3,
    };
  });

  const editorialCalendar = FUN_GALAXY_BRAND.editorialRhythms.map((rhythm) => {
    const occasion = FUN_GALAXY_BRAND.occasions[rhythm.occasion] || {};
    return {
      slot: rhythm.day,
      occasion: rhythm.occasion,
      occasionLabel: occasion.label || rhythm.occasion,
      channels: rhythm.channels,
      angle: occasion.emotionalHook || occasion.angle || '',
      why: rhythm.reason,
    };
  });
  editorialCalendar.push({
    slot: `Focus saison (${season.key})`,
    occasion: season.focus?.[0] || 'formules_decouverte',
    occasionLabel: (FUN_GALAXY_BRAND.occasions[season.focus?.[0]] || {}).label || 'Formules',
    channels: ['email', 'linkedin'],
    angle: season.hook,
    why: 'Accroche saisonniere a activer en priorite ce mois-ci.',
  });

  const contentImprovements = [];
  for (const draft of drafts) {
    const checks = draft.evaluation?.checks || [];
    const weak = checks
      .filter((check) => Number(check.score) < 85)
      .sort((a, b) => Number(a.score) - Number(b.score))
      .slice(0, 2);
    for (const check of weak) {
      contentImprovements.push({
        platform: draft.platform,
        occasion: draft.occasion,
        area: check.label,
        score: check.score,
        issue: check.note,
        fix: CRITERION_FIX_HINTS[check.id] || 'Affiner ce critere selon la note de controle.',
      });
    }
  }

  const priorities = [];
  const topGaps = gapAnalysis
    .filter((gap) => gap.status !== 'couvert')
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);
  topGaps.forEach((gap, index) => {
    priorities.push({
      rank: index + 1,
      action: `Lancer une campagne "${gap.label}" (${gap.audience}).`,
      impact: gap.insight,
    });
  });
  if (contentImprovements.length) {
    priorities.push({
      rank: priorities.length + 1,
      action: `Corriger ${contentImprovements.length} point(s) de contenu identifie(s) sur les scripts generes.`,
      impact: 'Fait passer les scripts de "a relire" a "pret a publier".',
    });
  }

  return {
    positioning: `${FUN_GALAXY_BRAND.identity.tagline}, ${FUN_GALAXY_BRAND.identity.mission}`,
    seasonalFocus: { period: season.key, hook: season.hook, occasions: season.focus || [] },
    proof: FUN_GALAXY_BRAND.proof,
    gapAnalysis,
    editorialCalendar,
    contentImprovements,
    priorities,
    externalSignals: observations.filter((obs) => obs.source && obs.source !== 'internal_playbook').length,
  };
}

// Etapes gamifiees pretes a afficher (missions) pour l'UI Campagnes.
function buildMarketingMissions({ summary = {}, strategy = {}, connectedAgents = 0, generationMode = 'rules' } = {}) {
  const total = Number(summary.ready || 0) + Number(summary.review || 0) + Number(summary.blocked || 0);
  return [
    {
      id: 'analyse',
      label: 'Analyse du centre',
      status: 'done',
      detail: 'Faits, activites disponibles et signaux de reservation collectes.',
    },
    {
      id: 'adn',
      label: 'ADN de marque applique',
      status: 'done',
      detail: strategy.positioning || FUN_GALAXY_BRAND.identity.tagline,
    },
    {
      id: 'generation',
      label: 'Generation des scripts',
      status: total > 0 ? 'done' : 'active',
      detail: `${total} script(s) generes (${generationMode === 'openai' ? 'IA + controle' : 'moteur ADN deterministe'}).`,
    },
    {
      id: 'qualite',
      label: 'Controle qualite',
      status: (summary.blocked || 0) > 0 ? 'attention' : 'done',
      detail: `${summary.ready || 0} pret(s), ${summary.review || 0} a relire, ${summary.blocked || 0} bloque(s).`,
    },
    {
      id: 'calendrier',
      label: 'Calendrier editorial',
      status: (strategy.editorialCalendar || []).length ? 'done' : 'todo',
      detail: `${(strategy.editorialCalendar || []).length} creneaux planifies, focus saison: ${strategy.seasonalFocus?.hook || ''}.`,
    },
    {
      id: 'publication',
      label: 'Connexion des canaux',
      status: connectedAgents > 0 ? 'active' : 'todo',
      detail: connectedAgents > 0
        ? `${connectedAgents} canal(aux) officiel(s) connecte(s).`
        : 'Connecter les canaux officiels pour publier depuis Pinlane.',
    },
  ];
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

// Insert multi-lignes des runs d'un cycle: un seul aller-retour DB pour les 5
// plateformes au lieu de 5 INSERT sequentiels.
async function persistRunRows(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const row of rows) {
    values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++}::jsonb)`);
    params.push(
      row.centerId,
      row.runId,
      row.runType || 'cycle',
      row.status || 'finished',
      row.platform,
      row.agentId,
      row.score || 0,
      row.summary || '',
      JSON.stringify(row.payload || {}),
    );
  }
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
      ) values ${values.join(',')};
    `,
    params,
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
  // Faits du warehouse quotidien (non-fatal : le cycle tourne sans warehouse).
  try {
    context.dataFacts = await buildDataFactsBundle(safeCenterId);
  } catch (error) {
    context.dataFacts = null;
  }
  const facts = buildCenterFacts(safeCenterId, context.knowledge);
  const signals = buildSignalPack(context);
  const runObjective = chooseObjective(signals, objective);
  const runId = `marketing-${safeCenterId}-${Date.now()}`;
  const learnedCriteria = await learnCriteriaFromObservations(safeCenterId, context.observations);
  // Chaque canal recoit une occasion distincte (variete reelle du contenu).
  const platformOccasions = assignPlatformOccasions(signals, objective);
  const drafts = [];
  const agents = [];
  const suggestions = [];

  for (const platform of PLATFORM_ORDER) {
    const agent = PLATFORM_AGENTS[platform];
    const platformObjective = platformOccasions[platform] || runObjective;
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
      objective: platformObjective,
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
      objective: platformObjective,
      channel: draft.channel || platform,
      occasion: draft.occasion || null,
      occasionLabel: draft.occasionLabel || '',
      audience: draft.audience || 'public',
      // Bloc pret a afficher pour l'UI (structure stable quel que soit le mode).
      content: {
        hook: draft.hook || '',
        angle: draft.angle || '',
        body: draft.body,
        benefits: draft.benefits || [],
        proof: draft.proof || FUN_GALAXY_BRAND.proof.ratingSentence,
        cta: draft.cta || '',
        urgency: draft.urgency || '',
        keywords: draft.keywords || draft.aiKeywords || [],
      },
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

  // Boucle data de l'agent (northstar « insight-only ») : idées ancrées SQL
  // persistées dans marketing_insights + mesure avant/après des idées appliquées.
  // Non-fatal : un warehouse vide ou une erreur SQL n'empêche jamais le cycle.
  let dataIdeas = null;
  let insightMeasurements = null;
  if (persist) {
    try {
      dataIdeas = await runDataIdeasCycle({ centerId: safeCenterId, bundle: context.dataFacts });
    } catch (error) {
      dataIdeas = { ok: false, message: error.message || 'Cycle idées data impossible.' };
    }
    try {
      insightMeasurements = await measureAppliedInsights({ centerId: safeCenterId });
      // Ferme la boucle : agrège l'effet mesuré par contexte (mémoire réutilisée
      // par runDataIdeasCycle au prochain cycle). Non-fatal.
      await aggregateMarketingPatterns({ centerId: safeCenterId });
    } catch (error) {
      insightMeasurements = { ok: false, message: error.message || 'Mesure des idées impossible.' };
    }
  }

  const summary = {
    averageScore: Math.round(agents.reduce((sum, agent) => sum + agent.score, 0) / agents.length),
    ready: agents.filter((agent) => agent.score >= 85).length,
    review: agents.filter((agent) => agent.score >= 70 && agent.score < 85).length,
    blocked: drafts.filter((draft) => draft.evaluation.blocked).length,
  };
  const strategy = buildMarketingStrategy({ facts, signals, drafts, observations: context.observations });
  const connectedAgents = agents.filter((agent) => agent.connected).length;
  const generationMode = drafts.some((draft) => draft.generationMode === 'openai') ? 'openai' : 'rules';
  const missions = buildMarketingMissions({ summary, strategy, connectedAgents, generationMode });

  return {
    ok: true,
    runId,
    centerId: safeCenterId,
    objective: runObjective,
    occasion: resolveOccasion(runObjective).id,
    startDate,
    endDate,
    facts,
    signals,
    brand: {
      name: FUN_GALAXY_BRAND.identity.name,
      tagline: FUN_GALAXY_BRAND.identity.tagline,
      voice: FUN_GALAXY_BRAND.identity.voice,
      proof: FUN_GALAXY_BRAND.proof,
      differentiators: FUN_GALAXY_BRAND.identity.differentiators,
    },
    agents,
    drafts,
    strategy,
    missions,
    learnedCriteria,
    summary,
    dataIdeas,
    insightMeasurements,
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
  const openAiConnected = Boolean(llmProvider());
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
      detail: 'Aucune cle IA (ANTHROPIC_API_KEY ou OPENAI_API_KEY): le moteur reste fiable en deterministe, mais moins adaptable.',
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

  // Strategie live: reconstruit les faits du centre et les derniers signaux/
  // drafts persistes pour livrer gap analysis, calendrier et ameliorations sans
  // relancer un cycle complet.
  const statusFacts = buildCenterFacts(safeCenterId);
  const latestSignals = runs.find((run) => run.payload?.signals)?.payload?.signals || buildSignalPack();
  const latestDrafts = [...latestByPlatform.values()].map((run) => run.payload).filter(Boolean);
  const strategy = buildMarketingStrategy({
    facts: statusFacts,
    signals: latestSignals,
    drafts: latestDrafts,
    observations,
  });
  const connectedAgents = agents.filter((agent) => agent.connected).length;
  const missions = buildMarketingMissions({
    summary: {
      ready: latestDrafts.filter((draft) => (draft.evaluation?.score || 0) >= 85).length,
      review: latestDrafts.filter((draft) => (draft.evaluation?.score || 0) >= 70 && (draft.evaluation?.score || 0) < 85).length,
      blocked: latestDrafts.filter((draft) => draft.evaluation?.blocked).length,
    },
    strategy,
    connectedAgents,
    generationMode: llmProvider() || 'rules',
  });

  return {
    ok: true,
    centerId: safeCenterId,
    brand: {
      name: FUN_GALAXY_BRAND.identity.name,
      tagline: FUN_GALAXY_BRAND.identity.tagline,
      voice: FUN_GALAXY_BRAND.identity.voice,
      proof: FUN_GALAXY_BRAND.proof,
      differentiators: FUN_GALAXY_BRAND.identity.differentiators,
    },
    strategy,
    missions,
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
  callAiMarketingAgent,
  collectFactNumbers,
  extractNumericTokens,
  ungroundedPriceClaims,
  CRITERION_FIX_HINTS,
  buildDraftVariants,
  buildMarketingMissions,
  buildMarketingStrategy,
  buildSignalPack,
  defaultCriteriaFor,
  getMarketingAgentStatus,
  getMarketingPlatforms,
  MIN_ACCEPTED_SCORE,
  recordMarketingFeedback,
  runMarketingAgentCycle,
  scoreDraft,
};
