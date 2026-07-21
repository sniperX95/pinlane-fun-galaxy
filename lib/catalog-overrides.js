// Couche d'OVERRIDES du catalogue no-code, fusionnee PAR-DESSUS le fichier
// socle ops-knowledge/formulas.json (table formule_overrides,
// database/catalog-overrides-schema.sql).
//
// DOCTRINE, verrouillee par scripts/catalog-overrides-check.js :
//   1. LE FICHIER RESTE LE SOCLE. Aucune ligne d'override = comportement
//      STRICTEMENT identique au fichier. La fusion ne fait que remplacer des
//      champs precis (name, price.value, price.oldValue) et exclure des
//      formules (enabled=false ou removed=true) ; elle ne reordonne pas, elle
//      n'invente rien.
//   2. PORTEE. L'override 'all' s'applique a tous les centres ; un override de
//      centre precis PRIME sur 'all', CHAMP PAR CHAMP (layering, pas
//      tout-ou-rien : un centre qui ne change que le prix herite du nom pose
//      par 'all').
//   3. PURETE. applyFormuleOverrides ne mute JAMAIS les objets de base : elle
//      clone avant toute ecriture. Deux appels sur le meme socle rendent des
//      listes independantes.
//   4. BORNES COTE SERVEUR. Les ecritures valident price 0..1000 et nom <= 120.
//      Une entree hors bornes est refusee (erreur exposee), jamais tronquee en
//      silence.
//
// Le socle est charge via require() (trace + embarque par le bundler Vercel),
// jamais fs.readFileSync (non trace -> ENOENT en prod, .vercelignore exclut
// ops-knowledge/). Meme raison que lib/ops-knowledge.js et lib/center-config.js.

const BASE_CATALOG = require('../ops-knowledge/formulas.json');

const PRICE_MIN = 0;
const PRICE_MAX = 1000;
const NAME_MAX = 120;
const DEFAULT_CENTER = 'all';
const CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const STACK_HASH_PATTERN = /^[0-9a-f]{40}$/;

function baseFormulas() {
  return Array.isArray(BASE_CATALOG.formulas) ? BASE_CATALOG.formulas : [];
}

const BASE_IDS = new Set(baseFormulas().map((formula) => formula.id));

function overrideKey(formuleId, centerId) {
  return `${formuleId}|${centerId}`;
}

function cloneFormula(formula) {
  return JSON.parse(JSON.stringify(formula));
}

function toNumOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Normalise une ligne SQL (types pg : numeric -> chaine, boolean, int) en objet
// applicatif stable. Une colonne absente/nulle devient null (pas d'ecart).
function normalizeRow(row) {
  return {
    formuleId: row.formule_id,
    centerId: row.center_id,
    name: row.name === null || row.name === undefined ? null : String(row.name),
    priceValue: toNumOrNull(row.price_value),
    priceOld: toNumOrNull(row.price_old),
    enabled: row.enabled === null || row.enabled === undefined ? null : Boolean(row.enabled),
    removed: Boolean(row.removed),
    sortIndex: row.sort_index === null || row.sort_index === undefined ? null : Math.trunc(Number(row.sort_index)),
  };
}

// ── Lecture ─────────────────────────────────────────────────────────────────

// Charge tous les overrides en une requete. Cle 'formuleId|centerId'.
async function loadFormuleOverrides(pool) {
  const result = await pool.query(
    `select formule_id, center_id, name, price_value, price_old, enabled, removed, sort_index
     from formule_overrides;`,
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(overrideKey(row.formule_id, row.center_id), normalizeRow(row));
  }
  return map;
}

// Combine l'override 'all' puis celui du centre : le centre PRIME champ par
// champ. removed est toujours defini quand la ligne existe (colonne not null),
// donc sa precedence est "la ligne la plus specifique gagne".
function effectiveOverride(overridesMap, formuleId, centerId) {
  const all = overridesMap.get(overrideKey(formuleId, DEFAULT_CENTER)) || null;
  const own = centerId && centerId !== DEFAULT_CENTER
    ? overridesMap.get(overrideKey(formuleId, centerId)) || null
    : null;
  if (!all && !own) return null;
  const pick = (field) => {
    if (own && own[field] !== null && own[field] !== undefined) return own[field];
    if (all && all[field] !== null && all[field] !== undefined) return all[field];
    return null;
  };
  return {
    name: pick('name'),
    priceValue: pick('priceValue'),
    priceOld: pick('priceOld'),
    enabled: pick('enabled'),
    removed: own ? own.removed : (all ? all.removed : false),
  };
}

// Fusion PURE : socle -> overrides. Ne mute jamais les objets de base (clone
// avant toute ecriture). Sans override pour une formule, la formule ressort
// identique au fichier. enabled=false ou removed=true l'excluent pour ce centre.
// L'ordre du fichier est preserve (sort_index n'agit pas ici, cf schema).
function applyFormuleOverrides(baseList, overridesMap, centerId = DEFAULT_CENTER) {
  const list = Array.isArray(baseList) ? baseList : [];
  const map = overridesMap instanceof Map ? overridesMap : new Map();
  const out = [];
  for (const base of list) {
    const eff = effectiveOverride(map, base.id, centerId);
    if (eff) {
      if (eff.removed === true) continue;
      if (eff.enabled === false) continue;
    }
    const merged = cloneFormula(base);
    if (eff) {
      if (eff.name !== null && eff.name !== undefined) merged.name = eff.name;
      if (eff.priceValue !== null && eff.priceValue !== undefined) {
        if (!merged.price) merged.price = {};
        merged.price.value = eff.priceValue;
      }
      if (eff.priceOld !== null && eff.priceOld !== undefined) {
        if (!merged.price) merged.price = {};
        merged.price.oldValue = eff.priceOld;
      }
    }
    out.push(merged);
  }
  return out;
}

// Le socle du fichier, fusionne avec les overrides en base pour un centre donne.
// C'est le point d'entree que le serveur branche pour que le tunnel public et le
// moteur refletent le catalogue edite (voir wiringNotes : consommateurs a cabler).
async function getMergedFormulas(pool, centerId = DEFAULT_CENTER) {
  const overridesMap = await loadFormuleOverrides(pool);
  return applyFormuleOverrides(baseFormulas(), overridesMap, centerId);
}

// ── Ecritures (bornes validees) ─────────────────────────────────────────────

function exposeError(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

function assertFormuleId(value) {
  const id = String(value || '').trim();
  if (!BASE_IDS.has(id)) throw exposeError('Formule inconnue.');
  return id;
}

function assertCenterId(value) {
  const id = String(value || DEFAULT_CENTER).trim().toLowerCase();
  if (id === DEFAULT_CENTER) return DEFAULT_CENTER;
  if (!CENTER_ID_PATTERN.test(id)) throw exposeError('Identifiant centre invalide (slug kebab-case ou "all").');
  return id;
}

// undefined => champ non fourni (le upsert garde l'existant).
// null       => efface explicitement l'ecart sur ce champ.
// nombre     => borne 0..1000, arrondi a 2 decimales (numeric(10,2)).
function validatePriceField(value, label) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < PRICE_MIN || parsed > PRICE_MAX) {
    throw exposeError(`${label} hors bornes (attendu ${PRICE_MIN} a ${PRICE_MAX}).`);
  }
  return Math.round(parsed * 100) / 100;
}

function validateName(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const name = String(value).trim();
  if (!name) return null;
  if (name.length > NAME_MAX) throw exposeError(`Nom trop long (max ${NAME_MAX} caracteres).`);
  return name;
}

function validateBool(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw exposeError('Valeur booleenne invalide.');
}

function validateSortIndex(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) throw exposeError('Ordre invalide.');
  return parsed;
}

// Upsert PARTIEL (patch) : lit l'existant, applique les champs fournis (undefined
// = garder, null = effacer), re-ecrit la ligne complete. Valide les bornes.
async function upsertFormuleOverride(pool, { formuleId, centerId = DEFAULT_CENTER, patch = {} } = {}) {
  const id = assertFormuleId(formuleId);
  const center = assertCenterId(centerId);
  const input = patch && typeof patch === 'object' ? patch : {};

  const namePatch = validateName(input.name);
  const pricePatch = validatePriceField(input.priceValue, 'Prix');
  const priceOldPatch = validatePriceField(input.priceOld, 'Ancien prix');
  const enabledPatch = validateBool(input.enabled);
  const removedPatch = validateBool(input.removed);
  const sortPatch = validateSortIndex(input.sortIndex);

  const existingResult = await pool.query(
    `select formule_id, center_id, name, price_value, price_old, enabled, removed, sort_index
     from formule_overrides where formule_id = $1 and center_id = $2 limit 1;`,
    [id, center],
  );
  const existing = existingResult.rows[0] ? normalizeRow(existingResult.rows[0]) : null;

  const keep = (patched, current) => (patched === undefined ? current : patched);
  const name = keep(namePatch, existing ? existing.name : null);
  const priceValue = keep(pricePatch, existing ? existing.priceValue : null);
  const priceOld = keep(priceOldPatch, existing ? existing.priceOld : null);
  const enabled = keep(enabledPatch, existing ? existing.enabled : null);
  const removedResolved = keep(removedPatch, existing ? existing.removed : false);
  const removed = removedResolved === null ? false : removedResolved; // colonne not null
  const sortIndex = keep(sortPatch, existing ? existing.sortIndex : null);

  const result = await pool.query(
    `insert into formule_overrides
       (formule_id, center_id, name, price_value, price_old, enabled, removed, sort_index, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (formule_id, center_id) do update set
       name = excluded.name,
       price_value = excluded.price_value,
       price_old = excluded.price_old,
       enabled = excluded.enabled,
       removed = excluded.removed,
       sort_index = excluded.sort_index,
       updated_at = now()
     returning formule_id, center_id, name, price_value, price_old, enabled, removed, sort_index;`,
    [id, center, name, priceValue, priceOld, enabled, removed, sortIndex],
  );
  return normalizeRow(result.rows[0]);
}

// Efface l'override d'une formule pour une portee : la formule redevient
// exactement le socle du fichier pour cette portee.
async function resetFormuleOverride(pool, { formuleId, centerId = DEFAULT_CENTER } = {}) {
  const id = assertFormuleId(formuleId);
  const center = assertCenterId(centerId);
  const result = await pool.query(
    `delete from formule_overrides where formule_id = $1 and center_id = $2;`,
    [id, center],
  );
  return { ok: true, removed: result.rowCount || 0 };
}

// ── Vue editeur (base + overrides visibles) ─────────────────────────────────

function stepResume(step) {
  const resume = { activityId: step.activityId, count: Number(step.count) || 1 };
  if (step.durationMinutes !== undefined && step.durationMinutes !== null) {
    resume.durationMinutes = Number(step.durationMinutes);
  }
  if (step.label) resume.label = String(step.label);
  if (step.critical) resume.critical = true;
  return resume;
}

// Ne garde que les champs qui portent un ECART (non null) : l'editeur voit ce
// qui a ete change, pas une soupe de null.
function definedFields(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source[field] !== null && source[field] !== undefined) out[field] = source[field];
  }
  return Object.keys(out).length ? out : null;
}

// Bundle de la page catalogue : le socle du fichier PLUS les overrides visibles,
// pour que l'editeur affiche la valeur de base et l'ecart cote a cote. Meme
// doctrine que le cockpit fondateur : le SaaS n'est pas lance -> testData: true.
async function buildFounderCatalog(pool) {
  const centersResult = await pool.query(`select id, name from centers order by id;`);
  const centers = centersResult.rows.map((row) => ({ id: row.id, name: row.name }));
  const overridesMap = await loadFormuleOverrides(pool);

  const formulas = baseFormulas().map((base) => {
    const allOv = overridesMap.get(overrideKey(base.id, DEFAULT_CENTER)) || null;
    const override = allOv
      ? definedFields(
        {
          name: allOv.name,
          priceValue: allOv.priceValue,
          priceOld: allOv.priceOld,
          enabled: allOv.enabled,
          removed: allOv.removed === true ? true : null,
        },
        ['name', 'priceValue', 'priceOld', 'enabled', 'removed'],
      )
      : null;

    const perCenter = {};
    for (const center of centers) {
      const ov = overridesMap.get(overrideKey(base.id, center.id));
      if (!ov) continue;
      const fields = definedFields(
        { enabled: ov.enabled, removed: ov.removed === true ? true : null, priceValue: ov.priceValue },
        ['enabled', 'removed', 'priceValue'],
      );
      if (fields) perCenter[center.id] = fields;
    }

    return {
      id: base.id,
      name: base.name,
      family: base.family || '',
      minPax: Number(base.minPax) || 0,
      price: {
        value: base.price && base.price.value !== undefined ? Number(base.price.value) : null,
        oldValue: base.price && base.price.oldValue !== undefined ? Number(base.price.oldValue) : null,
      },
      steps: Array.isArray(base.steps) ? base.steps.map(stepResume) : [],
      override,
      perCenter,
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    centers,
    formulas,
  };
}

// ── Dismiss des incidents console ───────────────────────────────────────────

function mapIncidentGroupRow(row) {
  return {
    stackHash: row.stack_hash,
    count: Number(row.count || 0),
    lastAt: row.last_at,
    firstAt: row.first_at,
    centers: Array.isArray(row.centers) ? row.centers.filter(Boolean) : [],
    pages: Array.isArray(row.pages) ? row.pages.filter(Boolean) : [],
    sampleMessage: row.sample_message || '',
    sampleSource: row.sample_source || '',
    sampleStackExcerpt: row.sample_stack_excerpt || '',
    membersTouches: Number(row.members_touches || 0),
  };
}

// Acquitte un groupe d'incidents (toutes les lignes du stack_hash encore
// ouvertes). Pose resolved_at/resolved_by, ne supprime rien. Renvoie le nombre
// de lignes acquittees.
async function dismissClientErrorGroup(pool, { stackHash, resolvedBy = '' } = {}) {
  const hash = String(stackHash || '').trim().toLowerCase();
  if (!STACK_HASH_PATTERN.test(hash)) throw exposeError('Identifiant de groupe invalide.');
  const by = String(resolvedBy || '').trim().slice(0, 120);
  const result = await pool.query(
    `update client_errors
       set resolved_at = now(), resolved_by = $2
     where stack_hash = $1 and resolved_at is null;`,
    [hash, by],
  );
  return { ok: true, resolved: result.rowCount || 0 };
}

// Groupes d'incidents OUVERTS : meme lecture groupee que
// lib/client-errors.loadClientErrorGroups, mais filtre resolved_at is null.
// C'est la voie propre choisie : on ne touche pas lib/client-errors.js
// (verrouille par son propre gate), l'integrateur branche CE loader dans
// buildFounderIncidents (cf wiringNotes). Prend pool en argument (testable,
// coherent avec les autres fonctions de ce module).
async function loadOpenIncidentGroups(pool, { limit = 30, sinceDays = 14 } = {}) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 30), 1), 100);
  const safeSinceDays = Math.min(Math.max(Math.trunc(Number(sinceDays) || 14), 1), 90);
  const result = await pool.query(
    `select
        stack_hash,
        count(*)::int as count,
        max(occurred_at) as last_at,
        min(occurred_at) as first_at,
        array_agg(distinct center_id) as centers,
        array_agg(distinct page) as pages,
        (array_agg(message order by occurred_at desc, id desc))[1] as sample_message,
        (array_agg(source order by occurred_at desc, id desc))[1] as sample_source,
        (array_agg(stack_excerpt order by occurred_at desc, id desc))[1] as sample_stack_excerpt,
        count(distinct member_id) filter (where member_id <> '')::int as members_touches
      from client_errors
      where occurred_at > now() - make_interval(days => $1)
        and resolved_at is null
      group by stack_hash
      order by last_at desc
      limit $2;`,
    [safeSinceDays, safeLimit],
  );
  return result.rows.map(mapIncidentGroupRow);
}

module.exports = {
  loadFormuleOverrides,
  applyFormuleOverrides,
  getMergedFormulas,
  upsertFormuleOverride,
  resetFormuleOverride,
  buildFounderCatalog,
  dismissClientErrorGroup,
  loadOpenIncidentGroups,
};
