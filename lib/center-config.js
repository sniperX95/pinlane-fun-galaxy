// Editable per-center configuration derived from ops-knowledge/centers.json.
// The deterministic engine reads center.resources.* / defaultSchedule / status,
// so an override persisted here (centers.settings.config) is what re-parametrises
// the engine once it is merged back onto the file baseline via ops-knowledge.
//
// La baseline est chargée via require() (tracé + embarqué par le bundler Vercel),
// pas fs.readFileSync (non tracé → ENOENT en prod car `.vercelignore` exclut
// ops-knowledge/).
const CENTERS_BASELINE = require('../ops-knowledge/centers.json');

const STATUS_VALUES = new Set(['active', 'planned', 'closed']);
const LASER_RISK_VALUES = new Set(['critical', 'managed', 'low']);
const CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const TIME_PATTERN = /^(?:[01][0-9]|2[0-4]):[0-5][0-9]$/;
const SCHEDULE_DAYS = ['0', '1', '2', '3', '4', '5', '6'];

const FALLBACK_BOWLING = {
  laneCount: 8,
  normalCapacityPerLane: 6,
  emergencyCapacityPerLane: 7,
  forceExtraLaneAtPax: 8,
  preferAdjacentLanes: true,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Deep merge of plain objects. Arrays and scalars from the override replace the
// base; nested plain objects are merged recursively. Never mutates its inputs.
function mergeCenterConfig(base, override) {
  if (!isPlainObject(base)) return isPlainObject(override) ? mergeCenterConfig({}, override) : (override ?? base);
  if (!isPlainObject(override)) return { ...base };
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    if (isPlainObject(overrideValue) && isPlainObject(result[key])) {
      result[key] = mergeCenterConfig(result[key], overrideValue);
    } else if (isPlainObject(overrideValue)) {
      result[key] = mergeCenterConfig({}, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeBowling(input) {
  if (input === null) return null;
  if (!isPlainObject(input)) return null;
  const laneCount = clampInt(input.laneCount, 1, 40, FALLBACK_BOWLING.laneCount);
  const normalCapacityPerLane = clampInt(input.normalCapacityPerLane, 1, 12, FALLBACK_BOWLING.normalCapacityPerLane);
  const emergencyRaw = clampInt(input.emergencyCapacityPerLane, 1, 15, Math.max(normalCapacityPerLane, FALLBACK_BOWLING.emergencyCapacityPerLane));
  const emergencyCapacityPerLane = Math.min(15, Math.max(normalCapacityPerLane, emergencyRaw));
  return {
    laneCount,
    normalCapacityPerLane,
    emergencyCapacityPerLane,
    forceExtraLaneAtPax: clampInt(input.forceExtraLaneAtPax, 1, 20, FALLBACK_BOWLING.forceExtraLaneAtPax),
    preferAdjacentLanes: asBoolean(input.preferAdjacentLanes, FALLBACK_BOWLING.preferAdjacentLanes),
  };
}

function normalizeLaser(input) {
  if (input === null) return null;
  if (!isPlainObject(input)) return null;
  const riskLevel = LASER_RISK_VALUES.has(input.riskLevel) ? input.riskLevel : 'managed';
  return {
    weaponCount: clampInt(input.weaponCount, 0, 200, 30),
    parallelLaunches: clampInt(input.parallelLaunches, 1, 20, 1),
    canSplitGroupsCleanly: asBoolean(input.canSplitGroupsCleanly, false),
    requiresCompleteGroupBeforeLaunch: asBoolean(input.requiresCompleteGroupBeforeLaunch, true),
    riskLevel,
  };
}

function normalizePartyTables(input) {
  if (input === null) return null;
  if (!isPlainObject(input)) return null;
  const softCapacity = clampInt(input.softCapacity, 1, 100, 6);
  const hardRaw = clampInt(input.hardCapacity, 1, 120, Math.max(softCapacity, 8));
  return {
    softCapacity,
    hardCapacity: Math.max(softCapacity, hardRaw),
  };
}

function normalizeBarDesk(input) {
  if (!isPlainObject(input)) return input === null ? null : undefined;
  return {
    handlesBooking: asBoolean(input.handlesBooking, true),
    handlesBriefing: asBoolean(input.handlesBriefing, true),
    handlesFoodAndDrink: asBoolean(input.handlesFoodAndDrink, true),
    activityEscort: asBoolean(input.activityEscort, false),
  };
}

function normalizeResources(input) {
  if (!isPlainObject(input)) return { bowling: null, laser: null, partyTables: null };
  const resources = {
    bowling: 'bowling' in input ? normalizeBowling(input.bowling) : undefined,
    laser: 'laser' in input ? normalizeLaser(input.laser) : undefined,
    partyTables: 'partyTables' in input ? normalizePartyTables(input.partyTables) : undefined,
  };
  if ('barDesk' in input) resources.barDesk = normalizeBarDesk(input.barDesk);
  // Drop undefined keys so a partial patch does not erase untouched resources.
  Object.keys(resources).forEach((key) => {
    if (resources[key] === undefined) delete resources[key];
  });
  return resources;
}

function normalizeDaySchedule(slot) {
  if (slot === null) return null;
  if (!isPlainObject(slot)) return undefined;
  const open = String(slot.open || '');
  const close = String(slot.close || '');
  if (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close)) return undefined;
  return { open, close };
}

function normalizeScheduleBlock(block) {
  if (!isPlainObject(block)) return undefined;
  const out = {};
  for (const day of SCHEDULE_DAYS) {
    if (!(day in block)) continue;
    const normalized = normalizeDaySchedule(block[day]);
    if (normalized !== undefined) out[day] = normalized;
  }
  return out;
}

function normalizeSchedule(input) {
  // Sentinel strings ("same_as_libramont_public_schedule", "to_confirm") are kept
  // as-is: they are resolved elsewhere and are not staff-editable time grids.
  if (typeof input === 'string') return input;
  if (!isPlainObject(input)) return undefined;
  const out = {};
  if ('regular' in input) {
    const regular = normalizeScheduleBlock(input.regular);
    if (regular !== undefined) out.regular = regular;
  }
  if ('holiday' in input) {
    const holiday = normalizeScheduleBlock(input.holiday);
    if (holiday !== undefined) out.holiday = holiday;
  }
  return out;
}

const HOLIDAY_OVERRIDE_MODES = new Set(['holiday', 'normal']);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HOLIDAY_OVERRIDES = 200;

// Overrides ponctuels (jour force "vacances" ou "normal"). Stockes en tableau :
// mergeCenterConfig remplace les tableaux, donc une sauvegarde staff peut aussi
// retirer un override (impossible avec une map fusionnee en profondeur).
function normalizeHolidayOverrides(input) {
  const list = Array.isArray(input) ? input : [];
  const byDate = new Map();
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const date = String(item.date || '').trim();
    const mode = String(item.mode || '').trim().toLowerCase();
    if (!ISO_DATE_PATTERN.test(date) || !HOLIDAY_OVERRIDE_MODES.has(mode)) continue;
    byDate.set(date, { date, mode });
    if (byDate.size >= MAX_HOLIDAY_OVERRIDES) break;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const HOLIDAY_PERIOD_TYPES = new Set(['public', 'school_short', 'school_summer', 'manual']);
const DEFAULT_FORMULA_BLOCKED_PERIODS = ['public', 'school_short', 'manual'];

function normalizeFormulaBlockedPeriods(input) {
  if (!Array.isArray(input)) return [...DEFAULT_FORMULA_BLOCKED_PERIODS];
  return [...new Set(input.map((value) => String(value)).filter((value) => HOLIDAY_PERIOD_TYPES.has(value)))];
}

function normalizeHolidaySettings(input) {
  if (!isPlainObject(input)) {
    return { enabled: true, overrides: [], formulaBlockedPeriods: [...DEFAULT_FORMULA_BLOCKED_PERIODS] };
  }
  return {
    enabled: asBoolean(input.enabled, true),
    overrides: normalizeHolidayOverrides(input.overrides),
    formulaBlockedPeriods: normalizeFormulaBlockedPeriods(input.formulaBlockedPeriods),
  };
}

// Disponibilite des offres/formules pilotee par le staff : map generique
// offerId -> boolean (absent = active). Aucun flag code en dur par formule.
function normalizeOfferAvailability(input) {
  if (!isPlainObject(input)) return {};
  const out = {};
  for (const key of Object.keys(input).slice(0, 200)) {
    const safeKey = String(key).trim();
    if (!/^[a-z0-9_-]{1,40}$/i.test(safeKey)) continue;
    out[safeKey] = asBoolean(input[key], true);
  }
  return out;
}

function normalizeActivityAvailability(input) {
  if (!isPlainObject(input)) return undefined;
  const out = {};
  for (const key of Object.keys(input)) {
    out[key] = asBoolean(input[key], false);
  }
  return out;
}

// Project a full center object (file baseline) onto the editable config surface.
function toEditableConfig(center) {
  return {
    status: STATUS_VALUES.has(center.status) ? center.status : 'active',
    timezone: String(center.timezone || 'Europe/Brussels'),
    resources: normalizeResources(center.resources || {}),
    defaultSchedule: normalizeSchedule(center.defaultSchedule),
    activityAvailability: normalizeActivityAvailability(center.activityAvailability) || {},
    holidaySettings: normalizeHolidaySettings(center.holidaySettings),
    offerAvailability: normalizeOfferAvailability(center.offerAvailability),
  };
}

const DEFAULT_CENTER_CONFIG_BY_ID = (() => {
  const map = {};
  try {
    (CENTERS_BASELINE.centers || []).forEach((center) => {
      map[center.id] = toEditableConfig(center);
    });
  } catch (error) {
    // Keep an empty default map rather than crashing at import time.
  }
  return map;
})();

function baseConfigFor(centerId) {
  return DEFAULT_CENTER_CONFIG_BY_ID[centerId]
    || {
      status: 'active',
      timezone: 'Europe/Brussels',
      resources: { bowling: { ...FALLBACK_BOWLING }, laser: null, partyTables: null },
      defaultSchedule: undefined,
      activityAvailability: {},
      holidaySettings: normalizeHolidaySettings(null),
      offerAvailability: {},
    };
}

// Validate + bound a (possibly partial) config against the center baseline.
// Always returns a coherent, fully-bounded config. Never throws on bad input.
function normalizeCenterConfig(input, baseId) {
  const base = baseConfigFor(baseId);
  const merged = mergeCenterConfig(base, isPlainObject(input) ? input : {});
  const config = {
    status: STATUS_VALUES.has(merged.status) ? merged.status : base.status,
    timezone: String(merged.timezone || base.timezone || 'Europe/Brussels').trim() || 'Europe/Brussels',
    resources: normalizeResources(merged.resources || {}),
    activityAvailability: normalizeActivityAvailability(merged.activityAvailability) || {},
    holidaySettings: normalizeHolidaySettings(merged.holidaySettings),
    offerAvailability: normalizeOfferAvailability(merged.offerAvailability),
  };
  const schedule = normalizeSchedule(merged.defaultSchedule);
  if (schedule !== undefined) config.defaultSchedule = schedule;
  return config;
}

function assertCenterId(centerId) {
  const value = String(centerId || '').trim().toLowerCase();
  if (!CENTER_ID_PATTERN.test(value)) {
    const e = new Error('Identifiant centre invalide (slug kebab-case attendu).'); e.expose = true; throw e;
  }
  return value;
}

function assertStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!STATUS_VALUES.has(value)) {
    const e = new Error('Statut centre invalide (active|planned|closed).'); e.expose = true; throw e;
  }
  return value;
}

// --- DB helpers -----------------------------------------------------------

async function loadCenterConfigOverrides(pool) {
  const result = await pool.query('select id, settings from centers;');
  const map = new Map();
  for (const row of result.rows) {
    const config = row.settings && typeof row.settings === 'object' ? row.settings.config : null;
    if (isPlainObject(config)) {
      map.set(row.id, config);
    }
  }
  return map;
}

async function saveCenterConfigOverride(pool, centerId, patch) {
  const id = assertCenterId(centerId);
  const existing = await pool.query('select settings from centers where id = $1 limit 1;', [id]);
  if (!existing.rowCount) {
    const e = new Error('Centre introuvable.'); e.expose = true; throw e;
  }
  const currentConfig = isPlainObject(existing.rows[0].settings?.config) ? existing.rows[0].settings.config : {};
  const mergedInput = mergeCenterConfig(currentConfig, isPlainObject(patch) ? patch : {});
  const normalized = normalizeCenterConfig(mergedInput, id);
  await pool.query(
    `
      update centers
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{config}', $2::jsonb, true),
          status = $3,
          updated_at = now()
      where id = $1;
    `,
    [id, JSON.stringify(normalized), normalized.status],
  );
  return normalized;
}

async function upsertCenter(pool, { id, name, status = 'active', timezone = 'Europe/Brussels' } = {}) {
  const centerId = assertCenterId(id);
  const safeName = String(name || '').trim();
  if (!safeName) { const e = new Error('Nom du centre requis.'); e.expose = true; throw e; }
  if (safeName.length > 120) { const e = new Error('Nom du centre trop long.'); e.expose = true; throw e; }
  const safeStatus = assertStatus(status);
  const safeTimezone = String(timezone || 'Europe/Brussels').trim() || 'Europe/Brussels';
  const result = await pool.query(
    `
      insert into centers (id, name, status, timezone)
      values ($1, $2, $3, $4)
      on conflict (id) do update set
        name = excluded.name,
        status = excluded.status,
        timezone = excluded.timezone,
        updated_at = now()
      returning id, name, status, timezone, settings;
    `,
    [centerId, safeName, safeStatus, safeTimezone],
  );
  return result.rows[0];
}

async function setCenterStatus(pool, centerId, status) {
  const id = assertCenterId(centerId);
  const safeStatus = assertStatus(status);
  const result = await pool.query(
    `
      update centers
      set status = $2,
          settings = jsonb_set(
            jsonb_set(coalesce(settings, '{}'::jsonb), '{config}', coalesce(settings->'config', '{}'::jsonb), true),
            '{config,status}', to_jsonb($2::text), true
          ),
          updated_at = now()
      where id = $1
      returning id, name, status, timezone, settings;
    `,
    [id, safeStatus],
  );
  if (!result.rowCount) throw new Error('Centre introuvable.');
  return result.rows[0];
}

// Authoritative editable view: DB centers list, each merged with its file
// baseline and re-bounded. Used by the config editor endpoint.
async function listCenterConfigs(pool) {
  const result = await pool.query('select id, name, status, timezone, settings from centers order by id asc;');
  return result.rows.map((row) => {
    const override = isPlainObject(row.settings?.config) ? row.settings.config : {};
    const config = normalizeCenterConfig(override, row.id);
    return {
      id: row.id,
      name: row.name,
      status: config.status || row.status,
      timezone: config.timezone || row.timezone,
      resources: config.resources,
      defaultSchedule: config.defaultSchedule ?? null,
      activityAvailability: config.activityAvailability,
      holidaySettings: config.holidaySettings,
      offerAvailability: config.offerAvailability,
    };
  });
}

module.exports = {
  DEFAULT_CENTER_CONFIG_BY_ID,
  FALLBACK_BOWLING,
  mergeCenterConfig,
  normalizeCenterConfig,
  toEditableConfig,
  assertCenterId,
  assertStatus,
  loadCenterConfigOverrides,
  saveCenterConfigOverride,
  upsertCenter,
  setCenterStatus,
  listCenterConfigs,
};
