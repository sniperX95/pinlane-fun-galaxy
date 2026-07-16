'use strict';

// LE STRATEGE (Phase 4) : le plan marketing pluri-semaines.
//
// Ce que fait ce module : il regarde les 8 prochaines semaines et dit, pour
// chacune, ce qu'il y a a jouer et POURQUOI, avec la confiance qu'on a
// reellement. Puis l'humain valide. Jamais de publication automatique.
//
// LA DECISION DE CONCEPTION QUI COMPTE
// Sur les vraies donnees de prod (2026-07-16) : 0 pattern mesure, et le seul
// fait disponible est « donnees encore jeunes (18 jours) ». Un stratege bati sur
// « ce qui marche chez nous » n'aurait rien a lire et inventerait, exactement
// comme l'IA inventait du Karting VR.
// Ce qui EST solide a 8 semaines, c'est le calendrier : conges scolaires FWB,
// jours feries calcules, evenements locaux dates. C'est verifiable, c'est date,
// et ca ne depend d'aucune mesure. Le plan se batit donc dessus.
// La meteo ne porte qu'a 7 jours : elle ne peut pas fonder une semaine 6 et
// n'entre pas dans le plan (elle reste au Studio, pour le post du jour).
//
// Quand marketing_patterns se remplira, le mesure prendra le dessus sur le
// calendrier pour les semaines ou il dit quelque chose. Le code est deja ecrit
// pour ca (voir weekConfidence et buildStrategistContext).

const { getPool } = require('./database');
const {
  SCHOOL_HOLIDAYS_FWB,
  LOCAL_EVENTS,
  publicHolidaysBE,
  listMarketingPatterns,
} = require('./center-metrics');
const { buildCenterFacts } = require('./marketing-agents');

const DEFAULT_HORIZON_WEEKS = 8;
const MAX_HORIZON_WEEKS = 12;

function defaultQuery(text, params) {
  return getPool().query(text, params);
}

// ── Calendrier (pur, deterministe, testable sans DB ni reseau) ───────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// Le lundi de la semaine contenant `iso`. Les semaines du plan sont calees sur
// le lundi : c'est la maille de decision du gerant, pas une date arbitraire.
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = dimanche
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(iso, delta);
}

function overlaps(aFrom, aTo, bFrom, bTo) {
  return aFrom <= bTo && bFrom <= aTo;
}

// Les faits calendaires qui tombent dans une semaine donnee. Aucun jugement
// ici : on collecte, on ne decide pas.
function weekCalendarFacts(weekFrom, weekTo, centerId) {
  const holidays = SCHOOL_HOLIDAYS_FWB
    .filter((h) => overlaps(weekFrom, weekTo, h.from, h.to))
    .map((h) => ({ type: 'conge_scolaire', label: h.label, from: h.from, to: h.to }));

  const years = [...new Set([weekFrom.slice(0, 4), weekTo.slice(0, 4)])];
  const publics = years
    .flatMap((y) => publicHolidaysBE(Number(y)))
    .filter((p) => p.date >= weekFrom && p.date <= weekTo)
    .map((p) => ({ type: 'jour_ferie', label: p.label, from: p.date, to: p.date }));

  const events = LOCAL_EVENTS
    .filter((e) => (!e.centerId || e.centerId === centerId) && overlaps(weekFrom, weekTo, e.from, e.to))
    .map((e) => ({ type: 'evenement_local', label: e.label, from: e.from, to: e.to }));

  return [...events, ...holidays, ...publics];
}

// L'horizon : N semaines a partir du lundi courant, chacune avec ses faits.
// Pur : meme entree, meme sortie. C'est le socle que l'IA n'a pas le droit de
// contredire.
function buildPlanHorizon(centerId = 'libramont', { today = null, weeks = DEFAULT_HORIZON_WEEKS } = {}) {
  const start = mondayOf(today || isoDate(new Date()));
  const count = Math.min(MAX_HORIZON_WEEKS, Math.max(1, Number(weeks) || DEFAULT_HORIZON_WEEKS));
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const from = addDays(start, i * 7);
    const to = addDays(from, 6);
    const facts = weekCalendarFacts(from, to, centerId);
    out.push({
      index: i + 1,
      from,
      to,
      // Une semaine sans fait calendaire n'est pas une semaine morte : c'est une
      // semaine ou il n'y a rien de DATE a jouer. On le dit, plutot que
      // d'inventer un pretexte. C'est la que le fond de commerce (anniversaires,
      // groupes) tourne.
      calendarFacts: facts,
      hasAnchor: facts.length > 0,
    });
  }
  return out;
}

// ── Contexte mesure (ce qu'on sait vraiment) ────────────────────────────────

// La confiance d'une semaine ne se decrete pas : elle vient de ce qu'on a.
// - 'mesure'    : un pattern mesure couvre ce contexte (n suffisant).
// - 'calendrier': un fait date et verifiable porte la semaine.
// - 'routine'   : rien de date, rien de mesure. C'est honnete de le dire.
function weekConfidence(week, patterns = []) {
  const measured = patterns.find((p) => Number(p.n) >= 3 && p.confidence !== 'exploratoire');
  if (measured) return 'mesure';
  if (week.hasAnchor) return 'calendrier';
  return 'routine';
}

async function buildStrategistContext(centerId = 'libramont', deps = {}) {
  const list = deps.listMarketingPatterns || listMarketingPatterns;
  const patterns = await list(centerId).catch(() => []);
  const facts = (deps.buildCenterFacts || buildCenterFacts)(centerId);
  const solidPatterns = (patterns || []).filter((p) => Number(p.n) >= 3 && p.confidence !== 'exploratoire');
  return {
    centerId,
    city: facts.city,
    activities: facts.activities,
    patterns: patterns || [],
    solidPatterns,
    // Le point le plus important a remonter a l'humain ET au modele : est-ce
    // qu'on sait quelque chose, oui ou non. Tant que c'est false, le plan est
    // un plan d'opportunites datees, pas un plan de performance.
    hasMeasuredEvidence: solidPatterns.length > 0,
  };
}

// ── Plan deterministe (le filet, jamais de page vide) ───────────────────────

// Ce que joue une semaine, deduit de ses faits. Aucune invention : si la
// semaine n'a pas d'ancre datee, on le dit et on renvoie au fond de commerce.
function deterministicWeekAngle(week, context) {
  const event = week.calendarFacts.find((f) => f.type === 'evenement_local');
  if (event) {
    return {
      objectif: `Capter le flux de ${event.label}`,
      pourquoi: `${event.label} du ${event.from} au ${event.to}, a proximite du centre. Du monde est deja sur place.`,
      actions: ['Un post avant l\'evenement (avant ou apres votre visite)', 'Un rappel le jour ou l\'affluence est la plus forte'],
    };
  }
  const holiday = week.calendarFacts.find((f) => f.type === 'conge_scolaire');
  const ferie = week.calendarFacts.find((f) => f.type === 'jour_ferie');
  if (holiday) {
    return {
      objectif: `Remplir les journees de ${holiday.label}`,
      pourquoi: `${holiday.label} (du ${holiday.from} au ${holiday.to}) : les enfants sont libres en journee, les parents cherchent une occupation.`,
      actions: ['Un post sur les formules famille', ferie ? `Un rappel pour ${ferie.label}` : 'Un rappel en milieu de semaine'].filter(Boolean),
    };
  }
  if (ferie) {
    return {
      objectif: `Jouer ${ferie.label}`,
      pourquoi: `${ferie.label} le ${ferie.from} : jour off, decision de sortie prise la veille ou le matin.`,
      actions: [`Un post 2 jours avant ${ferie.label}`],
    };
  }
  return {
    objectif: 'Le fond de commerce : anniversaires et groupes',
    pourquoi: 'Aucun evenement ni conge date cette semaine. C\'est la semaine ou l\'anniversaire enfant et les groupes portent le chiffre.',
    actions: ['Un post anniversaire enfant', 'Une relance des groupes deja venus'],
  };
}

function composeDeterministicPlan(horizon, context) {
  return horizon.map((week) => {
    const angle = deterministicWeekAngle(week, context);
    return {
      index: week.index,
      from: week.from,
      to: week.to,
      confiance: weekConfidence(week, context.patterns),
      ...angle,
      faits: week.calendarFacts,
    };
  });
}

// ── Garde-fou d'ancrage : le modele ne cree AUCUN fait ──────────────────────

// La lecon de la journee, appliquee d'avance. Un plan est un texte qui a l'air
// autoritaire ; s'il invente un evenement (« Salon du jeu a Namur le 12 »), le
// gerant le croit et publie dessus. Donc : tout label d'evenement, de conge ou
// de ferie present dans le plan DOIT exister dans l'horizon calculE ici, et
// toute semaine doit garder ses dates. Sinon la semaine est rejetee et le
// deterministe reprend la main pour elle.
function verifyPlanGrounding(weeks = [], horizon = []) {
  const byIndex = new Map(horizon.map((w) => [w.index, w]));
  const kept = [];
  const rejected = [];
  for (const week of weeks) {
    const ref = byIndex.get(week.index);
    if (!ref) { rejected.push({ index: week.index, motif: 'semaine hors horizon' }); continue; }
    if (week.from !== ref.from || week.to !== ref.to) {
      rejected.push({ index: week.index, motif: 'dates modifiees par le modele' });
      continue;
    }
    // Les labels autorises : ceux de CETTE semaine. Une Foire de Libramont
    // deplacee en semaine 5 est une invention, meme si le libelle existe.
    const allowed = new Set(ref.calendarFacts.map((f) => f.label.toLowerCase()));
    const claimed = (week.faits || []).map((f) => String(f.label || '').toLowerCase());
    const invented = claimed.filter((label) => label && !allowed.has(label));
    if (invented.length) {
      rejected.push({ index: week.index, motif: `fait invente : ${invented.join(', ')}` });
      continue;
    }
    kept.push({ ...week, faits: ref.calendarFacts, from: ref.from, to: ref.to });
  }
  return { kept, rejected };
}

// ── Couche IA : elle REDIGE, elle ne DECIDE pas des faits ───────────────────

// Le modele recoit l'horizon deja calcule et n'a le droit d'y ajouter aucun
// fait. Son travail : transformer des dates seches en objectifs lisibles par un
// gerant. Tout ce qu'il rend passe ensuite par verifyPlanGrounding, qui rejette
// sans discuter. Un appel unique pour les 8 semaines (le plan est cohérent ou
// il n'est pas), en Haiku, une fois par semaine : le cout est negligeable.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    weeks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          from: { type: 'string' },
          to: { type: 'string' },
          objectif: { type: 'string' },
          pourquoi: { type: 'string' },
          actions: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'from', 'to', 'objectif', 'pourquoi', 'actions'],
      },
    },
  },
  required: ['weeks'],
};

async function callStrategistModel(horizon, context, deps = {}) {
  const call = deps.callLlmJson || require('./llm-client').callLlmJson;
  const result = await call({
    stableSystem: [
      'Tu es le directeur marketing d\'un centre de loisirs indoor belge. Tu produis un plan sur plusieurs semaines qu\'un gerant doit pouvoir lire en 30 secondes et appliquer.',
      'REGLE ABSOLUE : tu n\'inventes AUCUN fait. Les evenements, conges et jours feries de chaque semaine te sont donnes. Tu n\'en ajoutes pas un seul, tu ne les deplaces pas d\'une semaine a l\'autre, tu ne changes aucune date. Une semaine sans fait date est une semaine de fond de commerce (anniversaires, groupes) : dis-le franchement plutot que d\'inventer un pretexte.',
      'REGLE DE PRUDENCE : tu ne sais pas ce qui a marche dans ce centre tant qu\'on ne te le dit pas. N\'affirme jamais qu\'une action va fonctionner ni ne cite de pourcentage. Le « pourquoi » s\'appuie sur le fait date, pas sur une performance supposee.',
      'objectif : une phrase, ce qu\'on cherche a remplir. pourquoi : le fait date qui le justifie, avec sa date. actions : 1 a 3 actions concretes, chacune faisable par une personne en 10 minutes.',
      'Ecris en francais, vouvoiement, sans tiret cadratin, sans jargon marketing.',
      'Reponds uniquement en JSON conforme au schema.',
    ].join('\n'),
    user: JSON.stringify({
      centre: { ville: context.city, activites: context.activities },
      // Dit au modele ce qu'on ne sait pas. C'est ce qui l'empeche de combler
      // le vide par de l'assurance.
      cePourQuoiOnNAAucuneMesure: context.hasMeasuredEvidence
        ? null
        : 'Aucune performance passee n\'est encore mesurable dans ce centre. Ne prétends rien sur ce qui marche.',
      patternsMesures: context.solidPatterns.map((p) => ({ contexte: p.context_key, effetNet: p.avg_net_delta, n: p.n })),
      semaines: horizon.map((w) => ({ index: w.index, from: w.from, to: w.to, faits: w.calendarFacts })),
    }),
    schema: PLAN_SCHEMA,
    schemaName: 'marketing_plan',
    maxTokens: 2000,
    timeoutMs: 30000,
  }).catch(() => null);
  return result && Array.isArray(result.weeks) ? result.weeks : null;
}

// ── Orchestration ───────────────────────────────────────────────────────────

// L'IA redige, le deterministe rattrape semaine par semaine. Une semaine
// rejetee par le garde-fou n'est pas perdue : elle reprend sa version
// deterministe. Le gerant a toujours 8 semaines, jamais un trou.
async function generateMarketingPlan(centerId = 'libramont', { today = null, weeks = DEFAULT_HORIZON_WEEKS, persist = true } = {}, deps = {}) {
  const horizon = buildPlanHorizon(centerId, { today, weeks });
  const context = await buildStrategistContext(centerId, deps);
  const fallback = composeDeterministicPlan(horizon, context);
  const byIndex = new Map(fallback.map((w) => [w.index, w]));

  let mode = 'rules';
  let rejected = [];
  const provider = (deps.llmProvider || require('./llm-client').llmProvider)();
  if (provider) {
    const aiWeeks = await callStrategistModel(horizon, context, deps);
    if (aiWeeks && aiWeeks.length) {
      const verified = verifyPlanGrounding(
        aiWeeks.map((w) => ({ ...w, faits: (byIndex.get(w.index) || {}).faits || [] })),
        horizon,
      );
      rejected = verified.rejected;
      for (const week of verified.kept) {
        const ref = byIndex.get(week.index);
        byIndex.set(week.index, {
          ...ref,
          objectif: String(week.objectif || ref.objectif).slice(0, 160),
          pourquoi: String(week.pourquoi || ref.pourquoi).slice(0, 300),
          actions: (week.actions || ref.actions).slice(0, 3).map((a) => String(a).slice(0, 160)),
        });
      }
      if (verified.kept.length) mode = 'ai';
    }
  }

  const plan = {
    mode,
    centerId,
    generatedAt: new Date().toISOString(),
    weeks: [...byIndex.values()].sort((a, b) => a.index - b.index),
    context: {
      hasMeasuredEvidence: context.hasMeasuredEvidence,
      patternsSolides: context.solidPatterns.length,
      // Trace ce que le garde-fou a rejete. Si ce compteur monte, c'est le
      // signal que le prompt derape, et on le voit sans lire les logs.
      semainesRejetees: rejected.length,
      motifsRejet: rejected.map((r) => r.motif),
    },
  };
  if (!persist) return { plan, saved: null };
  const saved = await savePlan(centerId, plan, deps).catch(() => null);
  return { plan, saved };
}

// ── Persistance ─────────────────────────────────────────────────────────────

// Idempotent : le job tourne sur une queue a retries. Un retry doit remplacer
// le plan, pas en creer un second (cf. l'index unique du schema).
async function savePlan(centerId, plan, { query = defaultQuery } = {}) {
  const weeks = plan.weeks || [];
  if (!weeks.length) throw new Error('Plan vide : rien a enregistrer.');
  const from = weeks[0].from;
  const to = weeks[weeks.length - 1].to;
  const { rows } = await query(
    `insert into marketing_plans (center_id, from_date, to_date, horizon, mode, payload, status)
     values ($1, $2, $3, $4, $5, $6, 'proposed')
     on conflict (center_id, from_date) where status <> 'archived'
     do update set to_date = excluded.to_date, horizon = excluded.horizon, mode = excluded.mode,
                   payload = excluded.payload, updated_at = now()
     returning id, center_id, from_date, to_date, status, mode, horizon, payload, created_at;`,
    [centerId, from, to, weeks.length, plan.mode || 'rules', JSON.stringify(plan)],
  );
  return rows[0];
}

async function listMarketingPlans(centerId, { query = defaultQuery, limit = 3 } = {}) {
  try {
    const { rows } = await query(
      `select id, center_id, from_date, to_date, status, mode, horizon, payload, created_at
         from marketing_plans where center_id = $1 and status <> 'archived'
        order by from_date desc limit $2;`,
      [centerId, limit],
    );
    return rows || [];
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
  // Calendrier pur
  isoDate,
  addDays,
  mondayOf,
  overlaps,
  weekCalendarFacts,
  buildPlanHorizon,
  // Contexte
  weekConfidence,
  buildStrategistContext,
  // Plan
  deterministicWeekAngle,
  composeDeterministicPlan,
  verifyPlanGrounding,
  callStrategistModel,
  generateMarketingPlan,
  savePlan,
  listMarketingPlans,
  defaultQuery,
};
