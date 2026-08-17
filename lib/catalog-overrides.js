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
// Store catalogue UNIFIE (socle fichier fusionne avec les lignes DB des tables
// formulas/formula_steps/activities). Lu EN LECTURE SEULE ici : buildClientCatalog
// doit refleter les formules custom (createFormula) et les editions de structure
// (updateFormula/setFormulaSteps) que le seul fichier socle ne porte pas. Aucune
// ecriture n'est faite via ce module.
const catalogStore = require('./catalog-store');
const ACTIVITIES_DOC = require('../ops-knowledge/activities.json');

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

// 'HH:MM' -> minutes depuis minuit (le store rend les plages horaires en HH:MM,
// l'editeur de structure les manipule en minutes, format canonique de la table).
function hhmmToMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const [hours, minutes] = String(value).split(':');
  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  return Number.isFinite(total) ? total : null;
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

// ── Ecritures CLIENT (cockpit centre, permission pricing.manage) ─────────────
//
// Un CLIENT n'edite QUE le tarif de SON centre : jamais l'override global 'all'
// partage par TOUS les tenants. Autoriser 'all' cote client serait la meme
// classe de faille que l'escalade de role (un tenant modifiant l'etat commun).
// assertClientCenterId REFUSE explicitement 'all' (et le vide) AVANT toute
// ecriture ; api/ops.js force deja le centre a celui de la session (withCenter),
// cette garde est la seconde barriere, verrouillee par scripts/client-tarifs-check.js.
function assertClientCenterId(value) {
  const center = assertCenterId(value);
  if (center === DEFAULT_CENTER) {
    throw exposeError('Un centre ne peut pas editer le tarif global partage (all).');
  }
  return center;
}

// Champs patchables cote client : identiques au fondateur (prix, ancien prix,
// nom, activation, retrait). Pas de sort_index (reordonnancement fondateur) et
// surtout PAS de creation/suppression de formule : assertFormuleId (dans
// upsertFormuleOverride) reste la garde du catalogue.
const CLIENT_PATCH_FIELDS = ['name', 'priceValue', 'priceOld', 'enabled', 'removed'];

function pickClientPatch(patch = {}) {
  const input = patch && typeof patch === 'object' ? patch : {};
  const out = {};
  for (const field of CLIENT_PATCH_FIELDS) {
    if (input[field] !== undefined) out[field] = input[field];
  }
  return out;
}

// Upsert client-safe : portee forcee a un centre precis ('all' refuse), patch
// restreint aux champs client. Reutilise upsertFormuleOverride (memes bornes,
// meme assertFormuleId) sans dupliquer la logique d'ecriture.
async function upsertClientFormuleOverride(pool, { formuleId, centerId, patch = {} } = {}) {
  const center = assertClientCenterId(centerId);
  return upsertFormuleOverride(pool, { formuleId, centerId: center, patch: pickClientPatch(patch) });
}

// Reset client-safe : efface l'override du CENTRE ('all' refuse) ; la formule
// redevient le socle pour ce centre uniquement.
async function resetClientFormuleOverride(pool, { formuleId, centerId } = {}) {
  const center = assertClientCenterId(centerId);
  return resetFormuleOverride(pool, { formuleId, centerId: center });
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

// ── Vue editeur CLIENT (base + override du centre, scopee a UN centre) ───────
//
// L'editeur tarifaire du cockpit CENTRE (permission pricing.manage) prefille
// avec l'etat courant et sait ce que CE centre a personnalise. Meme doctrine de
// fusion que buildFounderCatalog, mais SCOPEE a un seul centre : pour chaque
// formule, effective = base <- override 'all' <- override du centre, le centre
// primant CHAMP PAR CHAMP ; centerOverride = ce que le CENTRE (et lui seul) a
// pose (sert au badge "personnalise" et au bouton Reinitialiser). On inclut les
// formules retirees/desactivees pour permettre leur reactivation.
//
// SECURITE : assertClientCenterId REFUSE 'all'/vide EN TETE. Un centre ne lit
// jamais (et n'edite jamais) le tarif global partage : meme classe de faille que
// l'escalade de role. Le proprietaire platform.admin utilise buildFounderCatalog.
async function buildClientCatalog(pool, centerId) {
  const center = assertClientCenterId(centerId);
  const overridesMap = await loadFormuleOverrides(pool);

  // Enumeration depuis le STORE (socle + DB) et non plus le seul fichier : ainsi
  // les formules custom apparaissent et une formule supprimee (deleteFormula ->
  // active=false) sort de la liste. L'ordre suit le socle puis les customs.
  // getFormulaDoc reflete les editions de structure (updateFormula/setFormulaSteps).
  const bookingList = catalogStore.listBookingFormules();

  const formulas = bookingList.map((booking) => {
    const id = booking.id;
    const doc = catalogStore.getFormulaDoc(id) || {};
    const docPrice = doc.price || {};
    const basePriceValue = docPrice.value !== undefined && docPrice.value !== null ? Number(docPrice.value) : null;
    const basePriceOld = docPrice.oldValue !== undefined && docPrice.oldValue !== null ? Number(docPrice.oldValue) : null;
    const docName = doc.name != null ? String(doc.name) : (booking.name != null ? String(booking.name) : id);

    // Fusion base <- 'all' <- centre (le centre prime champ par champ).
    // effectiveOverride rend null quand aucun override (ni 'all' ni centre) n'existe.
    const eff = effectiveOverride(overridesMap, id, center);
    const effective = {
      name: eff && eff.name != null ? String(eff.name) : docName,
      priceValue: eff && eff.priceValue != null ? Number(eff.priceValue) : basePriceValue,
      priceOld: eff && eff.priceOld != null ? Number(eff.priceOld) : basePriceOld,
      enabled: eff && eff.enabled != null ? Boolean(eff.enabled) : true,
      removed: eff ? Boolean(eff.removed) : false,
    };

    // Ce que CE centre (et lui seul) a personnalise. L'override 'all' n'y figure
    // pas : centerOverride != null <=> ce centre a un ecart propre a reinitialiser.
    const centerOv = overridesMap.get(overrideKey(id, center)) || null;
    const centerOverride = centerOv
      ? definedFields(
        {
          name: centerOv.name,
          priceValue: centerOv.priceValue,
          priceOld: centerOv.priceOld,
          enabled: centerOv.enabled,
          removed: centerOv.removed === true ? true : null,
        },
        ['name', 'priceValue', 'priceOld', 'enabled', 'removed'],
      )
      : null;

    // Steps ORDONNEES completes : l'editeur d'activites en a besoin (position,
    // resourceType compris). position = index sequentiel (source de verite de l'ordre).
    const steps = Array.isArray(doc.steps)
      ? doc.steps.map((step, index) => ({
        position: index,
        activityId: step.activityId != null ? String(step.activityId) : '',
        count: Number(step.count) || 1,
        durationMinutes: step.durationMinutes != null ? Number(step.durationMinutes) : null,
        label: step.label != null ? String(step.label) : null,
        critical: step.critical === true,
        resourceType: step.resourceType != null ? String(step.resourceType) : null,
      }))
      : [];

    const timeLimit = doc.timeLimit || {};

    return {
      id,
      name: docName,
      family: doc.family != null ? String(doc.family) : (booking.family || ''),
      minPax: Number(doc.minPax) || 0,
      base: { priceValue: basePriceValue, priceOld: basePriceOld },
      effective,
      centerOverride,
      steps,
      // ── Champs d'AFFICHAGE du format booking : ce que les cartes de la
      // console montrent (grille Tarifs, Etablissement). desc est deja derive
      // des steps pour une formule custom (catalog-store) : sans ces champs,
      // la console re-derivait ou affichait des cartes vides.
      desc: Array.isArray(booking.desc) ? booking.desc.slice() : [],
      notes: Array.isArray(booking.notes) ? booking.notes.slice() : [],
      noHolidays: booking.noHolidays === true,
      best: booking.best === true,
      hasBowling: booking.hasBowling === true,
      bowlingDur: booking.bowlingDur != null ? Number(booking.bowlingDur) : null,
      estimatedTotalDuration: booking.estimatedTotalDuration != null ? Number(booking.estimatedTotalDuration) : null,
      // ── Champs de structure AJOUTES (edition du CATALOGUE partage) ──────────
      priceType: docPrice.type != null ? String(docPrice.type) : (booking.type || 'per_pax'),
      validDays: Array.isArray(doc.validDays) && doc.validDays.length ? doc.validDays.map(Number) : null,
      timeLimitMinMinutes: timeLimit.min != null ? hhmmToMinutes(timeLimit.min) : null,
      timeLimitMaxMinutes: timeLimit.max != null ? hhmmToMinutes(timeLimit.max) : null,
      // Le format booking porte la famille normalisee : les formules anniversaires
      // y sont 'Formules anniversaires' (seed comme custom), signal fiable.
      // Exposee telle quelle : les ecrans console groupent par CETTE famille
      // (doc.family dit 'Anniversaire', et tout partait en « speciales »).
      bookingFamily: booking.family || '',
      isBirthdayFormula: booking.family === 'Formules anniversaires',
      source: BASE_IDS.has(id) ? 'seed' : 'custom',
      active: true,
    };
  });

  const activities = await buildClientActivities(pool, center, formulas);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    centerId: center,
    formulas,
    activities,
  };
}

// Liste des activites selectionnables pour l'editeur de steps : socle fichier +
// activites referencees par les steps + lignes DB (activites custom). Resolues
// via getActivityDoc (reflete edition/retrait) ; les pseudo-activites (service_drinks,
// arcade_credit : absentes du catalogue, typees a la main) restent hors liste,
// l'editeur les preserve step par step via leur resourceType.
async function buildClientActivities(pool, center, formulas) {
  const ids = new Set();
  for (const activity of (ACTIVITIES_DOC.activities || [])) {
    if (activity && activity.id) ids.add(String(activity.id));
  }
  for (const formula of formulas) {
    for (const step of formula.steps) if (step.activityId) ids.add(step.activityId);
  }
  try {
    const state = await catalogStore.loadCatalogState(pool);
    for (const row of (state.activities || [])) if (row && row.id) ids.add(String(row.id));
  } catch (error) {
    // Store indisponible (base muette) : socle fichier + steps suffisent.
  }
  const out = [];
  for (const id of ids) {
    const doc = catalogStore.getActivityDoc(id, center);
    if (doc && doc.name) {
      out.push({ id, name: String(doc.name), resourceType: doc.resourceType != null ? String(doc.resourceType) : null });
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
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
  upsertClientFormuleOverride,
  resetClientFormuleOverride,
  buildFounderCatalog,
  buildClientCatalog,
  dismissClientErrorGroup,
  loadOpenIncidentGroups,
};
