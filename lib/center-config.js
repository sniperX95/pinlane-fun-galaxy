// Editable per-center configuration derived from ops-knowledge/centers.json.
// The deterministic engine reads center.resources.* / defaultSchedule / status,
// so an override persisted here (centers.settings.config) is what re-parametrises
// the engine once it is merged back onto the file baseline via ops-knowledge.
//
// La baseline est chargée via require() (tracé + embarqué par le bundler Vercel),
// pas fs.readFileSync (non tracé → ENOENT en prod car `.vercelignore` exclut
// ops-knowledge/).
const CENTERS_BASELINE = require('../ops-knowledge/centers.json');
const { FORMULES } = require('./booking-config');
const { normalizeDeclaredResources } = require('./declared-resources');

// Classification client/groupe : seuils et mapping anniversaire éditables par
// centre. Par défaut le « groupe » = ≥10 joueurs sur une résa (ou ≥18 cumulés,
// ou une formule) et l'anniversaire = toute formule de la famille anniversaire
// (f1-f8), en plus du chip « anniversaire » déclaré par le client.
const ALL_FORMULA_IDS = new Set(FORMULES.map((f) => f.id));
const DEFAULT_CLASSIFICATION = {
  groupMinPax: 10,
  groupMinCumulative: 18,
  countFormulaAsGroup: true,
  sizeTiers: { medium: 12, large: 30, xl: 60 },
  birthdayFromFormula: true,
  birthdayFormulaIds: FORMULES.filter((f) => /anniversaire/i.test(f.family || '')).map((f) => f.id),
  // Montant cumule depense a partir duquel un client est signale comme CLE.
  // 0 = seuil automatique (les 20 % qui depensent le plus). Editable par le
  // centre : ce qui fait un gros client a Libramont ne vaut pas ailleurs, et un
  // seuil qu'on ne peut pas regler est un seuil qu'on subit.
  keyClientMinSpend: 0,
};

const STATUS_VALUES = new Set(['active', 'planned', 'closed']);
const LASER_RISK_VALUES = new Set(['critical', 'managed', 'low']);
const CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const TIME_PATTERN = /^(?:[01][0-9]|2[0-4]):[0-5][0-9]$/;
const SCHEDULE_DAYS = ['0', '1', '2', '3', '4', '5', '6'];

const FALLBACK_BOWLING = {
  laneCount: 8,
  normalCapacityPerLane: 6,
  emergencyCapacityPerLane: 7,
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
  // Ressources DECLAREES par le centre (padel, paintball, salles...). Tableau :
  // mergeCenterConfig remplace les tableaux, donc une sauvegarde staff peut
  // aussi retirer une ressource (meme doctrine que holidayOverrides). Absente
  // du patch = intacte (cle retiree ci-dessous comme les autres).
  if ('declared' in input) resources.declared = normalizeDeclaredResources(input.declared);
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

// Activités PROPRES au centre, ajoutées/retirées par la direction (au-delà du
// catalogue moteur). { id: slug, label }. Bornées, dédupliquées, id normalisé.
const CUSTOM_ACTIVITY_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
function slugifyActivityId(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function normalizeCustomActivities(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    if (!isPlainObject(item)) continue;
    const label = String(item.label || item.name || '').trim().slice(0, 60);
    if (!label) continue;
    let id = String(item.id || '').trim().toLowerCase();
    if (!CUSTOM_ACTIVITY_ID.test(id)) id = slugifyActivityId(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= 40) break;
  }
  return out;
}

// COULEURS DU CENTRE (le tunnel public porte la marque de SON centre).
//
// Le magenta Fun Galaxy etait ecrit en dur dans assets/pinlane-client.css : tout
// deuxieme client heritait de la marque du premier. DESIGN.md interdit la
// couleur en dur et prevoit deja le jeton `--tenant-accent`. La couleur devient
// donc une DONNEE de centre : quatre jetons par theme, exactement ceux que le
// CSS consommait, et rien de plus (aucune couleur derivee par calcul : un
// contraste ne s'invente pas, il se declare).
//
// Absent = aucune marque = l'accent plateforme. C'est le defaut d'un centre
// nouvellement cree : neutre, jamais celui du voisin.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BRANDING_KEYS = ['accent', 'accentStrong', 'accentSoft', 'accentContrast'];

// LES AXES DE STYLE DU TUNNEL (2026-08-17). La couleur etait le seul reglage :
// le tunnel se personnalise desormais en entier. Chaque axe est un enum ferme
// (liste blanche) : une valeur inconnue est JETEE, jamais stockee. Absent =
// defaut plateforme. Le front les pose en data-attributs (applyCenterBranding)
// et pinlane-client.css les traduit en jetons.
const BRANDING_STYLE_AXES = {
  theme: ['auto', 'light', 'dark'],
  radius: ['sharp', 'soft', 'round'],
  font: ['geist', 'humanist', 'serif', 'mono'],
  backdrop: ['plain', 'tint', 'aurora'],
  cards: ['line', 'flat', 'shadow'],
  buttons: ['pill', 'rounded'],
};

function normalizeBrandingBlock(input) {
  if (!isPlainObject(input)) return null;
  const out = {};
  for (const key of BRANDING_KEYS) {
    const value = String(input[key] || '').trim().toLowerCase();
    if (HEX_COLOR.test(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeBrandingStyle(input) {
  if (!isPlainObject(input)) return null;
  const out = {};
  for (const [axis, allowed] of Object.entries(BRANDING_STYLE_AXES)) {
    const value = String(input[axis] || '').trim().toLowerCase();
    if (allowed.includes(value)) out[axis] = value;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeBranding(input) {
  if (!isPlainObject(input)) return null;
  const light = normalizeBrandingBlock(input);
  const dark = normalizeBrandingBlock(input.dark);
  const style = normalizeBrandingStyle(input);
  if (!light && !dark && !style) return null;
  return { ...(light || {}), ...(style || {}), ...(dark ? { dark } : {}) };
}

// L'IDENTITE du centre sur le tunnel public : logo, site, liens de navigation.
//
// Meme doctrine que la couleur ci-dessus. Le logo, le titre d'onglet, les
// quatre liens de navigation et le texte de ville etaient ecrits en dur dans
// index.html avec l'identite du premier client : tout autre centre les
// heritait. Ils deviennent une DONNEE de centre servie par public-booking-meta,
// bornee ici. Absent = tunnel neutre Pinlane, jamais l'identite d'un voisin.
//
// logoOnDark : le logo du centre est un lettrage clair qui exige un socle
// sombre en theme clair (cas du premier client). C'est une propriete du
// FICHIER logo, donc une donnee, jamais une regle CSS codee pour un client.
const IDENTITY_SITE_URL = /^https:\/\/[^\s"'<>]+$/i;
const IDENTITY_LOGO_URL = /^(?:https:\/\/[^\s"'<>]+|\.?\/?assets\/[a-z0-9_/.-]+)$/i;
const IDENTITY_MAX_LINKS = 6;

function normalizeIdentityLink(input) {
  if (!isPlainObject(input)) return null;
  const label = String(input.label || '').trim().slice(0, 40);
  const url = String(input.url || '').trim();
  if (!label || url.length > 300 || !IDENTITY_SITE_URL.test(url)) return null;
  return { label, url };
}

function normalizeIdentity(input) {
  if (!isPlainObject(input)) return null;
  const out = {};
  const logoUrl = String(input.logoUrl || '').trim();
  if (logoUrl && logoUrl.length <= 300 && IDENTITY_LOGO_URL.test(logoUrl)) {
    out.logoUrl = logoUrl;
    if (asBoolean(input.logoOnDark, false)) out.logoOnDark = true;
  }
  const siteUrl = String(input.siteUrl || '').trim();
  if (siteUrl && siteUrl.length <= 300 && IDENTITY_SITE_URL.test(siteUrl)) out.siteUrl = siteUrl;
  const siteLinks = (Array.isArray(input.siteLinks) ? input.siteLinks : [])
    .map(normalizeIdentityLink)
    .filter(Boolean)
    .slice(0, IDENTITY_MAX_LINKS);
  if (siteLinks.length) out.siteLinks = siteLinks;
  return Object.keys(out).length ? out : null;
}

// Liste d'ids de formules valides (dédupliquée). Un tableau vide est légitime
// (« aucune formule ne compte »); seul l'absence de tableau retombe sur le défaut.
function normalizeFormulaIdList(input, fallback) {
  if (!Array.isArray(input)) return [...fallback];
  const out = [];
  const seen = new Set();
  for (const value of input) {
    const id = String(value || '').trim();
    if (ALL_FORMULA_IDS.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

function normalizeSizeTiers(input) {
  const base = DEFAULT_CLASSIFICATION.sizeTiers;
  const src = isPlainObject(input) ? input : {};
  const medium = clampInt(src.medium, 2, 500, base.medium);
  const large = clampInt(src.large, medium, 1000, Math.max(base.large, medium));
  const xl = clampInt(src.xl, large, 2000, Math.max(base.xl, large));
  return { medium, large, xl: Math.max(large, xl) };
}

// Seuils/mapping de classification client & groupe (éditables côté Établissement).
function normalizeClassification(input) {
  const src = isPlainObject(input) ? input : {};
  return {
    groupMinPax: clampInt(src.groupMinPax, 2, 200, DEFAULT_CLASSIFICATION.groupMinPax),
    groupMinCumulative: clampInt(src.groupMinCumulative, 2, 5000, DEFAULT_CLASSIFICATION.groupMinCumulative),
    countFormulaAsGroup: asBoolean(src.countFormulaAsGroup, DEFAULT_CLASSIFICATION.countFormulaAsGroup),
    sizeTiers: normalizeSizeTiers(src.sizeTiers),
    birthdayFromFormula: asBoolean(src.birthdayFromFormula, DEFAULT_CLASSIFICATION.birthdayFromFormula),
    birthdayFormulaIds: normalizeFormulaIdList(src.birthdayFormulaIds, DEFAULT_CLASSIFICATION.birthdayFormulaIds),
    keyClientMinSpend: clampInt(src.keyClientMinSpend, 0, 100000, DEFAULT_CLASSIFICATION.keyClientMinSpend),
  };
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
    classification: normalizeClassification(center.classification),
    customActivities: normalizeCustomActivities(center.customActivities),
    branding: normalizeBranding(center.branding),
    identity: normalizeIdentity(center.identity),
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
      classification: normalizeClassification(null),
      customActivities: [],
      branding: null,
      identity: null,
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
    classification: normalizeClassification(merged.classification),
    customActivities: normalizeCustomActivities(merged.customActivities),
    branding: normalizeBranding(merged.branding),
    identity: normalizeIdentity(merged.identity),
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

// La LISTE DES CENTRES telle que la base la connait, identite comprise.
//
// loadCenterConfigOverrides ne rend que les centres qui ont deja une config
// sauvegardee, et seulement leur config : un centre cree depuis la console
// (upsertCenter, settings NULL) n'y figure pas du tout, et meme quand il y
// figure, son NOM n'y est pas. C'etait ce qui rendait getCenter incapable de
// connaitre un centre absent du fichier ops-knowledge/centers.json : il ne
// recevait jamais de quoi en construire un.
//
// Cette lecture-ci rend TOUTE ligne de `centers`, avec ce qui identifie le
// centre (nom, statut, fuseau) et sa config eventuelle. Le statut vient de la
// COLONNE : les deux chemins d'ecriture (upsertCenter et saveCenterConfigOverride)
// la tiennent a jour, alors que settings.config n'est ecrit que par le second.
async function loadCenterRecords(pool) {
  const result = await pool.query('select id, name, status, timezone, settings from centers;');
  return result.rows.map((row) => ({
    id: row.id,
    name: String(row.name || row.id || ''),
    status: String(row.status || ''),
    timezone: String(row.timezone || ''),
    config: isPlainObject(row.settings?.config) ? row.settings.config : {},
  }));
}

// Garde "pistes orphelines" : reduire laneCount (8 -> 6) laisse des reservations
// et des lane_statuses sur les pistes retirees (7, 8), ignorees par les boucles
// for(lane <= laneCount) mais toujours en base. Choix le plus SUR (aucune
// suppression de donnee client, doctrine "preserver le vault/les donnees") :
// REFUSER la reduction tant qu'une reservation FUTURE non annulee occupe une
// piste au-dela du nouveau total. Le staff deplace ou annule ces reservations
// d'abord. On ne supprime jamais rien automatiquement.
// sim-unfiltered: lecture de CAPACITE, pas d'analytique. Une reservation de
// simulation occupe une piste REELLE aux yeux du planificateur (SENS 2 du gate
// simulation-isolation, qui exige que les lecteurs de capacite voient tout).
// L'exclure ici laisserait reduire le nombre de pistes sous une piste qu'une
// ligne de simulation occupe encore : le planificateur continuerait de la voir
// sur une piste qui n'existe plus. Aucun euro ne transite par cette requete.
async function assertNoFutureReservationsBeyondLane(pool, centerId, laneCount) {
  const result = await pool.query(
    `
      select
        id,
        to_char(date, 'YYYY-MM-DD') as date_str,
        array(select lane_no from unnest(lanes) as lane_no where lane_no > $2 order by lane_no) as orphan_lanes
      from reservations
      where center_id = $1
        and status <> 'cancelled'
        and validation_status <> 'rejected'
        and date >= (now() at time zone 'Europe/Brussels')::date
        and exists (select 1 from unnest(lanes) as lane_no where lane_no > $2)
      order by date asc, start_time asc
      limit 50;
    `,
    [centerId, laneCount],
  );
  if (!result.rowCount) return;
  const rows = result.rows;
  const examples = rows
    .slice(0, 3)
    .map((row) => `${row.date_str} piste(s) ${(row.orphan_lanes || []).join(', ')}`)
    .join(' ; ');
  const suffix = rows.length > 3 ? ` et ${rows.length - 3} autre(s)` : '';
  const e = new Error(
    `Reduction a ${laneCount} pistes refusee: ${rows.length} reservation(s) future(s) occupent encore une piste au-dela de ${laneCount} (${examples}${suffix}). Deplacez ou annulez ces reservations avant de reduire le nombre de pistes.`,
  );
  e.expose = true;
  throw e;
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
  // Ne declenche la garde QUE sur une vraie reduction du nombre de pistes : une
  // sauvegarde qui ne touche pas laneCount (ou l'augmente) passe sans requete ni
  // refus (doctrine defaut = inchange).
  const previousLaneCount = Number(normalizeCenterConfig(currentConfig, id).resources.bowling?.laneCount) || 0;
  const nextLaneCount = Number(normalized.resources.bowling?.laneCount) || 0;
  if (nextLaneCount > 0 && previousLaneCount > 0 && nextLaneCount < previousLaneCount) {
    await assertNoFutureReservationsBeyondLane(pool, id, nextLaneCount);
  }
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
      classification: config.classification,
      customActivities: config.customActivities,
      branding: config.branding,
      identity: config.identity,
    };
  });
}

module.exports = {
  DEFAULT_CENTER_CONFIG_BY_ID,
  FALLBACK_BOWLING,
  DEFAULT_CLASSIFICATION,
  normalizeClassification,
  normalizeCustomActivities,
  normalizeBranding,
  normalizeIdentity,
  mergeCenterConfig,
  normalizeCenterConfig,
  toEditableConfig,
  assertCenterId,
  assertStatus,
  loadCenterConfigOverrides,
  loadCenterRecords,
  saveCenterConfigOverride,
  upsertCenter,
  setCenterStatus,
  listCenterConfigs,
};
