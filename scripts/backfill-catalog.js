// Backfill du catalogue unifie (migration 0038 : tables activities / formulas /
// formula_steps). Lit les TROIS fichiers socle et insere des lignes source='seed'
// avec les MEMES ids. Idempotent (upsert on conflict).
//
// DOCTRINE : apres ce backfill, les lignes DB == contenu des fichiers, donc le
// comportement est IDENTIQUE (prix au centime, verdicts de dispo, ancrage). C'est
// verrouille par scripts/catalog-store-check.js, qui rejoue exactement les lignes
// que buildSeedRows() produit ici.
//
// RECONCILIATION (les DEUX catalogues formule fusionnes pour une meme id) :
//   * family / price(value,oldValue) / minPax / validDays / humanValidation /
//     order_policy / steps  ->  ops-knowledge/formulas.json (la source moteur).
//   * price_type (per_pax|per_lane) / best  ->  lib/booking-config FORMULES.
//   * description_lines  =  desc[] de booking-config (texte d'affichage).
//   * is_birthday_formula  =  /anniversaire/i.test(family de booking-config)
//     (remplace le regex applique a la volee ; la famille stockee est celle de
//     formulas.json).
//   * timeLimit  ->  MINUTES depuis minuit. 'HH:MM' (formulas.json) et heures
//     numeriques * 60 (booking-config). Si les DEUX existent et DIVERGENT, on
//     prend formulas.json et on LOG la divergence.
//   * not_during_holidays  ->  formulas.json (notDuringHolidays). Log si booking
//     (noHolidays) diverge.
//   * hasBowling / bowlingDur : NON stockes (derives des steps a la lecture).
//
// Ne LANCE rien tout seul cote DB : `node scripts/backfill-catalog.js` insere,
// `--check` / `--dry-run` imprime les lignes SANS base.

const FORMULES = require('../lib/booking-config').FORMULES;
const DOC_FORMULAS = require('../ops-knowledge/formulas.json').formulas;
const ACTIVITIES = require('../ops-knowledge/activities.json').activities;

function hhmmToMinutes(value) {
  if (value == null) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function hoursToMinutes(value) {
  return value == null ? null : Math.round(Number(value) * 60);
}

// Fusionne booking + doc pour une id et rend { row, steps, divergences }.
function reconcileFormula(bookingBase, docBase, sortIndex) {
  const id = (docBase || bookingBase).id;
  const divergences = [];

  // Source moteur (formulas.json) pour la plupart des champs.
  const doc = docBase || {};
  const booking = bookingBase || {};

  // price_type depuis booking-config ; log si formulas.json diverge.
  const priceType = booking.type != null ? booking.type : (doc.price ? doc.price.type : null);
  if (docBase && booking.type != null && doc.price && doc.price.type != null && doc.price.type !== booking.type) {
    divergences.push(`${id}: price_type booking=${booking.type} vs formulas.json=${doc.price.type} (garde booking)`);
  }

  const priceValue = doc.price && doc.price.value != null ? Number(doc.price.value)
    : (booking.price != null ? Number(booking.price) : null);
  const priceOld = doc.price && doc.price.oldValue != null ? Number(doc.price.oldValue)
    : (booking.oldPrice != null ? Number(booking.oldPrice) : null);
  if (docBase && bookingBase && booking.price != null && doc.price && doc.price.value != null
    && Number(doc.price.value) !== Number(booking.price)) {
    divergences.push(`${id}: price booking=${booking.price} vs formulas.json=${doc.price.value} (garde formulas.json)`);
  }

  // timeLimit -> minutes. Diverge => formulas.json + log.
  const docMin = doc.timeLimit && doc.timeLimit.min != null ? hhmmToMinutes(doc.timeLimit.min) : null;
  const docMax = doc.timeLimit && doc.timeLimit.max != null ? hhmmToMinutes(doc.timeLimit.max) : null;
  const bookingMin = booking.timeLimit && booking.timeLimit.min != null ? hoursToMinutes(booking.timeLimit.min) : null;
  const bookingMax = booking.timeLimit && booking.timeLimit.max != null ? hoursToMinutes(booking.timeLimit.max) : null;
  let timeLimitMin = docBase ? docMin : bookingMin;
  let timeLimitMax = docBase ? docMax : bookingMax;
  if (docBase && bookingBase) {
    if (docMin != null && bookingMin != null && docMin !== bookingMin) {
      divergences.push(`${id}: timeLimit.min booking=${bookingMin} vs formulas.json=${docMin} (garde formulas.json)`);
    }
    if (docMax != null && bookingMax != null && docMax !== bookingMax) {
      divergences.push(`${id}: timeLimit.max booking=${bookingMax} vs formulas.json=${docMax} (garde formulas.json)`);
    }
    // Si l'un porte une borne que l'autre n'a pas : formulas.json fait foi mais on log.
    if ((docMin == null) !== (bookingMin == null)) {
      divergences.push(`${id}: timeLimit.min present d'un seul cote (booking=${bookingMin}, formulas.json=${docMin}) (garde formulas.json)`);
      timeLimitMin = docMin;
    }
    if ((docMax == null) !== (bookingMax == null)) {
      divergences.push(`${id}: timeLimit.max present d'un seul cote (booking=${bookingMax}, formulas.json=${docMax}) (garde formulas.json)`);
      timeLimitMax = docMax;
    }
  }

  const notDuringHolidays = docBase ? doc.notDuringHolidays === true : booking.noHolidays === true;
  if (docBase && bookingBase && (doc.notDuringHolidays === true) !== (booking.noHolidays === true)) {
    divergences.push(`${id}: not_during_holidays booking=${booking.noHolidays === true} vs formulas.json=${doc.notDuringHolidays === true} (garde formulas.json)`);
  }

  const validDays = Array.isArray(doc.validDays) ? doc.validDays.slice()
    : (Array.isArray(booking.validDays) ? booking.validDays.slice() : null);

  const isBirthday = /anniversaire/i.test((booking.family) || '');

  const row = {
    id,
    name: doc.name != null ? doc.name : booking.name,
    family: doc.family != null ? doc.family : booking.family, // famille formulas.json
    min_pax: doc.minPax != null ? doc.minPax : booking.minPax,
    price_type: priceType,
    price_value: priceValue,
    price_old: priceOld,
    not_during_holidays: notDuringHolidays,
    valid_days: validDays,
    time_limit_min_minutes: timeLimitMin,
    time_limit_max_minutes: timeLimitMax,
    human_validation: doc.humanValidation != null ? doc.humanValidation : null,
    order_policy: doc.orderPolicy != null ? doc.orderPolicy : null,
    is_birthday_formula: isBirthday,
    best: booking.best === true,
    description_lines: Array.isArray(booking.desc) ? booking.desc.slice() : [],
    sort_index: sortIndex,
    source: 'seed',
    active: true,
  };

  const sourceSteps = Array.isArray(doc.steps) ? doc.steps : [];
  const steps = sourceSteps.map((step, index) => ({
    formula_id: id,
    position: index,
    activity_id: step.activityId != null ? step.activityId : null,
    count: step.count != null ? Math.trunc(Number(step.count)) : 1,
    duration_minutes: step.durationMinutes != null ? Math.trunc(Number(step.durationMinutes)) : null,
    label: step.label != null ? step.label : null,
    critical: step.critical === true,
    resource_type: step.resourceType != null ? step.resourceType : null,
  }));

  return { row, steps, divergences };
}

// Lignes seed pour les 3 tables (pur, sans base). C'est la SOURCE que le gate
// rejoue : buildSeedRows() -> store -> deep-equal avec les fichiers.
function buildSeedRows() {
  const bookingById = new Map(FORMULES.map((formule) => [formule.id, formule]));
  const docById = new Map(DOC_FORMULAS.map((doc) => [doc.id, doc]));
  const allIds = [];
  // Ordre : ordre booking-config, puis toute id presente seulement dans formulas.json.
  for (const formule of FORMULES) allIds.push(formule.id);
  for (const doc of DOC_FORMULAS) if (!bookingById.has(doc.id)) allIds.push(doc.id);

  const formulas = [];
  const steps = [];
  const divergences = [];
  allIds.forEach((id, index) => {
    const { row, steps: formulaSteps, divergences: div } = reconcileFormula(
      bookingById.get(id) || null,
      docById.get(id) || null,
      index,
    );
    formulas.push(row);
    steps.push(...formulaSteps);
    divergences.push(...div);
  });

  const activities = ACTIVITIES.map((activity) => ({
    id: activity.id,
    center_id: 'all',
    name: activity.name != null ? activity.name : null,
    resource_type: activity.resourceType != null ? activity.resourceType : null,
    duration_model: activity.durationModel != null ? activity.durationModel : null,
    service_model: activity.serviceModel != null ? activity.serviceModel : null,
    risk_drivers: Array.isArray(activity.riskDrivers) ? activity.riskDrivers.slice() : null,
    planning_pressure: activity.planningPressure != null ? activity.planningPressure : null,
    source: 'seed',
    active: true,
  }));

  return { formulas, steps, activities, divergences };
}

// ── Ecriture DB (idempotente) ─────────────────────────────────────────────────
async function upsertActivity(client, row) {
  await client.query(
    `insert into activities
       (id, center_id, name, resource_type, duration_model, service_model, risk_drivers, planning_pressure, source, active, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, now())
     on conflict (id, center_id) do update set
       name = excluded.name,
       resource_type = excluded.resource_type,
       duration_model = excluded.duration_model,
       service_model = excluded.service_model,
       risk_drivers = excluded.risk_drivers,
       planning_pressure = excluded.planning_pressure,
       source = excluded.source,
       active = excluded.active,
       updated_at = now();`,
    [
      row.id, row.center_id, row.name, row.resource_type,
      row.duration_model == null ? null : JSON.stringify(row.duration_model),
      row.service_model == null ? null : JSON.stringify(row.service_model),
      row.risk_drivers, row.planning_pressure, row.source, row.active,
    ],
  );
}

async function upsertFormula(client, row) {
  await client.query(
    `insert into formulas
       (id, name, family, min_pax, price_type, price_value, price_old, not_during_holidays,
        valid_days, time_limit_min_minutes, time_limit_max_minutes, human_validation, order_policy,
        is_birthday_formula, best, description_lines, sort_index, source, active, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     on conflict (id) do update set
       name = excluded.name,
       family = excluded.family,
       min_pax = excluded.min_pax,
       price_type = excluded.price_type,
       price_value = excluded.price_value,
       price_old = excluded.price_old,
       not_during_holidays = excluded.not_during_holidays,
       valid_days = excluded.valid_days,
       time_limit_min_minutes = excluded.time_limit_min_minutes,
       time_limit_max_minutes = excluded.time_limit_max_minutes,
       human_validation = excluded.human_validation,
       order_policy = excluded.order_policy,
       is_birthday_formula = excluded.is_birthday_formula,
       best = excluded.best,
       description_lines = excluded.description_lines,
       sort_index = excluded.sort_index,
       source = excluded.source,
       active = excluded.active,
       updated_at = now();`,
    [
      row.id, row.name, row.family, row.min_pax, row.price_type, row.price_value, row.price_old,
      row.not_during_holidays, row.valid_days, row.time_limit_min_minutes, row.time_limit_max_minutes,
      row.human_validation, row.order_policy, row.is_birthday_formula, row.best, row.description_lines,
      row.sort_index, row.source, row.active,
    ],
  );
}

async function upsertStep(client, row) {
  await client.query(
    `insert into formula_steps
       (formula_id, position, activity_id, count, duration_minutes, label, critical, resource_type)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (formula_id, position) do update set
       activity_id = excluded.activity_id,
       count = excluded.count,
       duration_minutes = excluded.duration_minutes,
       label = excluded.label,
       critical = excluded.critical,
       resource_type = excluded.resource_type;`,
    [
      row.formula_id, row.position, row.activity_id, row.count,
      row.duration_minutes, row.label, row.critical, row.resource_type,
    ],
  );
}

async function main() {
  const seed = buildSeedRows();
  if (seed.divergences.length) {
    console.warn(`backfill-catalog: ${seed.divergences.length} divergence(s) de reconciliation :`);
    for (const line of seed.divergences) console.warn(`  - ${line}`);
  } else {
    console.log('backfill-catalog: aucune divergence de reconciliation (les deux catalogues concordent).');
  }

  if (process.argv.includes('--check') || process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      counts: { formulas: seed.formulas.length, steps: seed.steps.length, activities: seed.activities.length },
      divergences: seed.divergences,
      formulas: seed.formulas,
      steps: seed.steps,
      activities: seed.activities,
    }, null, 2));
    return;
  }

  const { getPool } = require('../lib/database');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const row of seed.activities) await upsertActivity(client, row);
    for (const row of seed.formulas) await upsertFormula(client, row);
    for (const row of seed.steps) await upsertStep(client, row);
    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      mode: 'applied',
      counts: { formulas: seed.formulas.length, steps: seed.steps.length, activities: seed.activities.length },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await getPool().end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { buildSeedRows, reconcileFormula };
