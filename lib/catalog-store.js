// Catalogue UNIFIE (source DB unique fusionnee par-dessus les fichiers socle).
//
// DOCTRINE, verrouillee par scripts/catalog-store-check.js :
//   1. LES FICHIERS RESTENT LE SOCLE. Aucune ligne en base (tables activities /
//      formulas / formula_steps de la migration 0038) = comportement STRICTEMENT
//      identique aux fichiers (ops-knowledge/formulas.json, activities.json,
//      lib/booking-config FORMULES).
//   2. APRES BACKFILL SEED (lignes = contenu des fichiers) = comportement
//      IDENTIQUE : meme prix au centime, memes verdicts de dispo, meme deep-equal
//      des docs (steps compris), meme modele d'ancrage.
//   3. FUSION. Une ligne DB pour un id PRIME sur le socle (par id). active=false
//      retire la formule/activite. source='custom' (id absent des fichiers) est
//      une entree ajoutee.
//   4. DEUX ADAPTATEURS, UNE SOURCE. getFormulaDoc rend le format
//      ops-knowledge/formulas.json ; getBookingFormule le format
//      lib/booking-config FORMULES. Les deux derivent de la MEME entree
//      canonique : c'est le coeur de l'unification.
//
// MECANIQUE DE CACHE : identique a refreshCenterOverrides (lib/ops-knowledge) et
// refreshFormuleOverrides (lib/booking-config) : cache module, TTL 30 s,
// fail-soft (sur erreur base on garde le dernier etat connu). getFormulaDoc /
// getBookingFormule / getActivityDoc restent SYNCHRONES, lus partout.
//
// CANONIQUE : time_limit en MINUTES depuis minuit (le 'HH:MM' de formulas.json
// et les heures numeriques de booking-config en derivent). description_lines =
// desc[] d'affichage de booking-config ; la DUREE vient des steps, plus du desc.
// hasBowling / bowlingDur ne sont PAS stockes : ils se derivent des steps.
//
// Les fichiers socle sont charges via require() (traces + embarques par le
// bundler Vercel), jamais fs.readFileSync (non trace -> ENOENT en prod, cf
// lib/ops-knowledge.js et lib/center-config.js).

const { FORMULES } = require('./booking-config');
const { normalizeActivityPricing } = require('./activity-pricing');
const FORMULAS_DOC_FILE = require('../ops-knowledge/formulas.json');
const ACTIVITIES_FILE = require('../ops-knowledge/activities.json');

const OVERRIDE_TTL_MS = 30_000;
const DEFAULT_ACTIVITY_CENTER = 'all';

// PORTEE ENTREPRISE (migration 0042). `owner_client_id` joue pour les formules
// exactement le role que `center_id` joue deja pour les activites :
//   * 'all'        = catalogue PLATEFORME (socle livre + edition proprietaire),
//                    lu par tout le monde ;
//   * '<clientId>' = propriete d'une entreprise. Sa ligne PRIME sur celle de la
//                    plateforme pour le meme id, et SEULS ses centres la lisent.
// La maille est l'ENTREPRISE, pas le centre : deux centres d'un meme client
// partagent leur catalogue, c'est voulu (Libramont et Gembloux).
const PLATFORM_SCOPE = 'all';
// Portee d'un centre INCONNU de la carte centre->entreprise quand celle-ci est
// chargee : une portee dediee qui ne possede rien et ne voit pas le socle.
// Jamais un id d'entreprise reel (prefixe __) : voir resolveScopeForCenter.
const ORPHAN_CENTER_SCOPE = '__orphan_center__';

// ---- LE SOCLE LIVRE DANS LE CODE APPARTIENT A UN CLIENT --------------------
//
// `ops-knowledge/formulas.json`, `ops-knowledge/activities.json` et
// `lib/booking-config FORMULES` sont dans le depot, et la doctrine ci-dessus les
// servait a TOUTE entreprise. Sauf que ce socle n'est pas generique : ce sont
// les 14 formules de Fun Galaxy (FORMULE 1 a 8, MATIN MALIN, CRAZY STUDENT
// STRIKE...) et ses 12 activites (laser game, minigolf blacklight, karting VR,
// golf o'Clock, fun run...). Tout nouveau client heritait donc du catalogue du
// premier.
//
// Mesure en base le 2026-08-21 : N4 portait 14 lignes `source=seed,
// active=false` dont le SEUL role etait de refuser une par une les formules de
// Fun Galaxy (zero etape, zero reservation), et MI12, qui n'en a aucune, les
// voyait toutes. Movsar : « pour N4 il doit rien avoir comme activite ou quoi
// de Fun Galaxy, et ca pour tous les centres que je vais creer aussi. »
//
// LA REGLE : le socle est la PROPRIETE du client qui l'a apporte. Une autre
// entreprise ne le voit pas, meme pas pour le refuser : elle part d'un catalogue
// VIDE et n'a que ce qu'elle cree. Le jour ou le produit livrera un vrai socle
// generique (des MODELES copies a la creation d'un client, pas un catalogue
// partage), cette constante disparaitra avec lui.
const FILE_SEED_OWNER_CLIENT_ID = 'fungalaxy';

// Le scope plateforme garde le socle : c'est le repli des chemins internes
// (resolveFormulaDocAnyScope, appels sans centre) et du demarrage a froid.
// Un centre sans entreprise, lui, EXISTE (upsertCenter n'ecrit pas client_id)
// et recoit une portee dediee vide : voir resolveScopeForCenter.
function seedVisibleForScope(scope) {
  return scope === FILE_SEED_OWNER_CLIENT_ID || scope === PLATFORM_SCOPE;
}

// Modes de tarification d'une activite (migration 0039).
//   grid_bowling / grid_laser : les GRILLES EXISTANTES de lib/booking-config
//     font foi (prix par piste selon la duree, prix par joueur selon le nombre
//     de parties). Elles ne sont pas dupliquees ici : un tarif recopie a deux
//     endroits finit toujours par diverger.
//   per_pax       : priceValue euros par personne.
//   per_unit_hour : priceValue euros par unite (table de billard...) et par heure.
//   on_site       : facture au comptoir, aucun montant annonce.
const ACTIVITY_PRICE_TYPES = new Set(['grid_bowling', 'grid_laser', 'per_pax', 'per_unit_hour', 'on_site']);
// Les deux seules activites qui CONTRAIGNENT le planning : elles occupent une
// ressource comptee (piste, arene). Tout le reste se joue en capacite souple et
// n'entre jamais dans un calcul de disponibilite.
const PLANNED_RESOURCE_TYPES = new Set(['bowling_lane', 'laser_arena']);

// ── Baselines (fichiers) indexes par id ─────────────────────────────────────
const BOOKING_BASE_BY_ID = new Map(FORMULES.map((formule) => [formule.id, formule]));
const DOC_BASE_BY_ID = new Map((FORMULAS_DOC_FILE.formulas || []).map((doc) => [doc.id, doc]));
// Ordre de reference des formules = l'ordre du fichier booking-config (le tunnel
// et getEffectiveFormules doivent servir les formules dans CET ordre).
const BASELINE_ORDER = FORMULES.map((formule) => formule.id);
const ACTIVITY_BASE_BY_ID = new Map((ACTIVITIES_FILE.activities || []).map((activity) => [activity.id, activity]));

// ── Conversions temporelles ─────────────────────────────────────────────────
function hhmmToMinutes(value) {
  if (value == null) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function minutesToHhmm(value) {
  const total = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function hoursToMinutes(value) {
  return value == null ? null : Math.round(Number(value) * 60);
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value) {
  const parsed = numOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

// La base porte-t-elle les colonnes de la migration 0041 ? Decide de la forme
// des SELECT/INSERT (voir loadCatalogState). false par defaut : la forme
// historique est toujours sure.
let dbHasChainColumns = false;

// La base porte-t-elle la colonne de portee de la migration 0042 ? false par
// defaut : tant qu'elle n'est PAS appliquee, toutes les lignes valent 'all' et
// le comportement est celui d'avant (catalogue partage). C'est ce qui permet de
// deployer le code AVANT la migration sans trou : la portee s'allume toute
// seule au premier rafraichissement qui suit l'application.
let dbHasOwnerScope = false;

// La base porte-t-elle la colonne de la migration 0043 (tarif d'activite par
// jour et par creneau) ? Meme mecanique que les autres drapeaux : tant qu'elle
// manque, une activite n'a qu'un prix et rien ne change.
let dbHasActivityPricing = false;

// Portee lisible d'une valeur brute : toujours une chaine, jamais vide.
function normalizeScope(value) {
  const scope = String(value == null ? PLATFORM_SCOPE : value).trim().toLowerCase();
  return scope || PLATFORM_SCOPE;
}

// Contrainte d'ordre (P3) : liste bornee de paires [avant, apres]. Tout le
// reste est jete : une contrainte malformee ne doit jamais atteindre le moteur.
function normalizeOrderConstraints(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const before = String(pair[0] || '').trim().slice(0, 60);
    const after = String(pair[1] || '').trim().slice(0, 60);
    if (!before || !after || before === after) continue;
    out.push([before, after]);
    if (out.length >= 12) break;
  }
  return out.length ? out : null;
}

// ── Normalisation des lignes DB (types pg -> objet applicatif stable) ────────
function normalizeFormulaRow(row) {
  return {
    id: row.id,
    ownerClientId: normalizeScope(row.owner_client_id),
    name: row.name == null ? null : String(row.name),
    family: row.family == null ? null : String(row.family),
    minPax: intOrNull(row.min_pax),
    priceType: row.price_type == null ? null : String(row.price_type),
    priceValue: numOrNull(row.price_value),
    priceOld: numOrNull(row.price_old),
    notDuringHolidays: Boolean(row.not_during_holidays),
    validDays: Array.isArray(row.valid_days) ? row.valid_days.map(Number) : null,
    timeLimitMin: intOrNull(row.time_limit_min_minutes),
    timeLimitMax: intOrNull(row.time_limit_max_minutes),
    humanValidation: row.human_validation == null ? null : String(row.human_validation),
    orderPolicy: row.order_policy == null ? null : String(row.order_policy),
    orderConstraints: normalizeOrderConstraints(row.order_constraints),
    isBirthdayFormula: Boolean(row.is_birthday_formula),
    best: Boolean(row.best),
    descriptionLines: Array.isArray(row.description_lines) ? row.description_lines.map(String) : [],
    sortIndex: intOrNull(row.sort_index),
    source: row.source === 'custom' ? 'custom' : 'seed',
    active: row.active === undefined || row.active === null ? true : Boolean(row.active),
  };
}

function normalizeStepRow(row) {
  return {
    formulaId: row.formula_id,
    ownerClientId: normalizeScope(row.owner_client_id),
    position: intOrNull(row.position),
    activityId: row.activity_id == null ? null : String(row.activity_id),
    count: row.count == null ? 1 : Math.trunc(Number(row.count)),
    durationMinutes: intOrNull(row.duration_minutes),
    label: row.label == null ? null : String(row.label),
    critical: Boolean(row.critical),
    resourceType: row.resource_type == null ? null : String(row.resource_type),
    // Colonnes 0041, absentes avant application : undefined -> historique exact.
    pax: intOrNull(row.pax),
    optional: row.optional === true,
  };
}

function normalizeActivityRow(row) {
  return {
    id: row.id,
    ownerClientId: normalizeScope(row.owner_client_id),
    centerId: row.center_id == null ? DEFAULT_ACTIVITY_CENTER : String(row.center_id),
    name: row.name == null ? null : String(row.name),
    resourceType: row.resource_type == null ? null : String(row.resource_type),
    durationModel: row.duration_model == null ? null : row.duration_model,
    serviceModel: row.service_model == null ? null : row.service_model,
    riskDrivers: Array.isArray(row.risk_drivers) ? row.risk_drivers.map(String) : null,
    planningPressure: row.planning_pressure == null ? null : String(row.planning_pressure),
    // Colonnes de la migration 0039. NULL = "pas d'avis", pas "non" : la valeur
    // du socle s'applique (cf buildCanonicalActivity). Les lignes seed deja en
    // base les ont toutes a NULL et ne changent donc rien.
    bookable: row.bookable == null ? null : Boolean(row.bookable),
    priceType: row.price_type == null ? null : String(row.price_type),
    priceValue: numOrNull(row.price_value),
    priceUnit: row.price_unit == null ? null : String(row.price_unit),
    bookingOrder: intOrNull(row.booking_order),
    // Migration 0043. NULL = un seul prix.
    pricing: normalizeActivityPricing(row.pricing),
    source: row.source === 'custom' ? 'custom' : 'seed',
    active: row.active === undefined || row.active === null ? true : Boolean(row.active),
  };
}

// ── Steps -> forme canonique (une seule representation interne) ──────────────
function canonicalStepFromDoc(step) {
  return {
    activityId: step.activityId == null ? null : String(step.activityId),
    count: step.count == null ? 1 : Math.trunc(Number(step.count)),
    durationMinutes: step.durationMinutes == null ? null : Math.trunc(Number(step.durationMinutes)),
    label: step.label == null ? null : String(step.label),
    critical: step.critical === true,
    resourceType: step.resourceType == null ? null : String(step.resourceType),
    // P2 : effectif propre et caractere optionnel de l'etape. Aucun fichier
    // existant ne les porte : null/false = strictement l'historique.
    pax: step.pax == null ? null : Math.trunc(Number(step.pax)),
    optional: step.optional === true,
  };
}

function canonicalStepFromDbRow(row) {
  return {
    activityId: row.activityId,
    count: row.count == null ? 1 : Math.trunc(Number(row.count)),
    durationMinutes: row.durationMinutes,
    label: row.label,
    critical: row.critical === true,
    resourceType: row.resourceType,
    pax: row.pax == null ? null : Math.trunc(Number(row.pax)),
    optional: row.optional === true,
  };
}

// ── Construction de l'entree CANONIQUE (socle fusionne avec la ligne DB) ─────
// Une ligne DB (dbRow) PRIME sur le socle par champ ; les extras propres au
// format booking (notes, estimatedTotalDuration, famille libelle) ne sont PAS en
// base : ils viennent du socle booking, ou sont derives pour une formule custom.
// Les deux libelles que la base porte depuis toujours, et ce que l'ecran a
// toujours montre a leur place. Table de SYNONYMES d'affichage, jamais une
// liste de valeurs autorisees : n'importe quelle autre categorie passe telle
// que le gerant l'a ecrite.
const FAMILY_DISPLAY_SYNONYMS = new Map([
  ['anniversaire', 'Formules anniversaires'],
  ['speciale', 'Formules speciales'],
]);

function canonicalFamilyLabel(raw, isBirthday) {
  const family = String(raw == null ? '' : raw).trim();
  if (!family) return isBirthday ? 'Formules anniversaires' : 'Formules speciales';
  const synonym = FAMILY_DISPLAY_SYNONYMS.get(family.toLowerCase());
  return synonym || family;
}

function buildCanonicalFormula({ id, bookingBase, docBase, dbRow, dbSteps }) {
  const hasDb = Boolean(dbRow);

  const docFamily = hasDb ? dbRow.family : (docBase ? docBase.family : null);
  const isBirthday = hasDb
    ? dbRow.isBirthdayFormula
    : /anniversaire/i.test((bookingBase && bookingBase.family) || '');
  // ---- LA CATEGORIE SAISIE FAIT FOI (2026-08-22) --------------------------
  //
  // Ce libelle est celui que lisent la console (« Tarifs & formules »,
  // Etablissement > Offres) ET le tunnel : c'est lui qui decoupe les sections.
  // Il ignorait purement et simplement dbRow.family, donc une categorie creee
  // par un gerant n'existait nulle part a l'ecran. Mesure en base le
  // 2026-08-22 : N4 portait deja « Bowling », « Groupes » et « Promotions »,
  // et personne ne les voyait.
  //
  // Les deux libelles HISTORIQUES continuent de s'afficher comme avant. Sans
  // cette equivalence, faire primer la base renommait du jour au lendemain les
  // sections de Fun Galaxy (« Anniversaire », « Speciale ») sans que personne
  // l'ait demande. Ce sont des synonymes d'affichage, pas une liste fermee :
  // toute autre valeur passe telle quelle.
  const bookingFamily = canonicalFamilyLabel(
    hasDb ? dbRow.family : (bookingBase ? bookingBase.family : ''),
    isBirthday,
  );

  const priceType = hasDb
    ? dbRow.priceType
    : (bookingBase ? bookingBase.type : (docBase && docBase.price ? docBase.price.type : null));
  const priceValue = hasDb
    ? dbRow.priceValue
    : (docBase && docBase.price ? Number(docBase.price.value) : (bookingBase ? Number(bookingBase.price) : 0));
  const priceOld = hasDb
    ? dbRow.priceOld
    : (docBase && docBase.price && docBase.price.oldValue != null
      ? Number(docBase.price.oldValue)
      : (bookingBase && bookingBase.oldPrice != null ? Number(bookingBase.oldPrice) : null));

  let timeLimitMin = null;
  let timeLimitMax = null;
  if (hasDb) {
    timeLimitMin = dbRow.timeLimitMin;
    timeLimitMax = dbRow.timeLimitMax;
  } else if (docBase && docBase.timeLimit) {
    timeLimitMin = docBase.timeLimit.min != null ? hhmmToMinutes(docBase.timeLimit.min) : null;
    timeLimitMax = docBase.timeLimit.max != null ? hhmmToMinutes(docBase.timeLimit.max) : null;
  } else if (bookingBase && bookingBase.timeLimit) {
    timeLimitMin = bookingBase.timeLimit.min != null ? hoursToMinutes(bookingBase.timeLimit.min) : null;
    timeLimitMax = bookingBase.timeLimit.max != null ? hoursToMinutes(bookingBase.timeLimit.max) : null;
  }

  const validDaysRaw = hasDb
    ? dbRow.validDays
    : (docBase && Array.isArray(docBase.validDays)
      ? docBase.validDays
      : (bookingBase && Array.isArray(bookingBase.validDays) ? bookingBase.validDays : null));
  const validDays = Array.isArray(validDaysRaw) && validDaysRaw.length ? validDaysRaw.map(Number) : null;

  let steps;
  if (hasDb && Array.isArray(dbSteps) && dbSteps.length) {
    steps = dbSteps.slice().sort((a, b) => Number(a.position) - Number(b.position)).map(canonicalStepFromDbRow);
  } else if (docBase && Array.isArray(docBase.steps)) {
    steps = docBase.steps.map(canonicalStepFromDoc);
  } else {
    steps = [];
  }

  return {
    id,
    source: hasDb ? dbRow.source : 'seed',
    active: hasDb ? dbRow.active : true,
    sortIndex: hasDb ? dbRow.sortIndex : null,
    name: hasDb ? dbRow.name : (docBase ? docBase.name : (bookingBase ? bookingBase.name : id)),
    docFamily,
    bookingFamily,
    isBirthday,
    minPax: hasDb ? dbRow.minPax : (docBase ? docBase.minPax : (bookingBase ? bookingBase.minPax : 1)),
    priceType,
    priceValue,
    priceOld,
    notDuringHolidays: hasDb
      ? dbRow.notDuringHolidays
      : (docBase ? docBase.notDuringHolidays === true : (bookingBase ? bookingBase.noHolidays === true : false)),
    validDays,
    timeLimitMin,
    timeLimitMax,
    orderPolicy: hasDb ? dbRow.orderPolicy : (docBase ? (docBase.orderPolicy == null ? null : docBase.orderPolicy) : null),
    // P3 : la ligne DB prime, sinon le socle fichier. Personne n'en porte
    // aujourd'hui : null = ordre libre, comportement historique exact.
    orderConstraints: hasDb
      ? (dbRow.orderConstraints || null)
      : (docBase ? normalizeOrderConstraints(docBase.orderConstraints) : null),
    humanValidation: hasDb ? dbRow.humanValidation : (docBase ? (docBase.humanValidation == null ? null : docBase.humanValidation) : null),
    best: hasDb ? dbRow.best : (bookingBase ? bookingBase.best === true : false),
    // description_lines vient de la DB si presente, sinon du desc[] booking.
    descriptionLines: hasDb ? dbRow.descriptionLines.slice() : (bookingBase && Array.isArray(bookingBase.desc) ? bookingBase.desc.slice() : []),
    // Extras PROPRES au format booking, jamais stockes en base : socle uniquement.
    notes: bookingBase && Array.isArray(bookingBase.notes) ? bookingBase.notes.slice() : [],
    estimatedTotalDuration: bookingBase && bookingBase.estimatedTotalDuration != null ? bookingBase.estimatedTotalDuration : null,
    steps,
  };
}

function buildCanonicalActivity({ id, centerId, base, dbRow }) {
  const hasDb = Boolean(dbRow);
  // Champs de la 0038 : la ligne DB prime en bloc (doctrine d'origine).
  // Champs de la 0039 (booking) : la ligne DB prime CHAMP PAR CHAMP, une valeur
  // NULL laissant parler le socle. Sans cette nuance, les 11 lignes seed deja
  // backfillees (donc hasDb=true, colonnes 0039 a NULL) auraient efface le bloc
  // booking de TOUTES les activites des la migration.
  const baseBooking = (base && base.booking && typeof base.booking === 'object') ? base.booking : null;
  const pick = (dbValue, baseValue) => (hasDb && dbValue != null ? dbValue : baseValue);
  return {
    id,
    centerId,
    source: hasDb ? dbRow.source : 'seed',
    active: hasDb ? dbRow.active : true,
    name: hasDb ? dbRow.name : (base ? base.name : null),
    resourceType: hasDb ? dbRow.resourceType : (base ? base.resourceType : null),
    durationModel: hasDb ? dbRow.durationModel : (base ? base.durationModel : null),
    serviceModel: hasDb ? dbRow.serviceModel : (base ? base.serviceModel : null),
    riskDrivers: hasDb ? dbRow.riskDrivers : (base && Array.isArray(base.riskDrivers) ? base.riskDrivers : null),
    planningPressure: hasDb
      ? dbRow.planningPressure
      : (base && base.planningPressure != null ? base.planningPressure : null),
    booking: (baseBooking || (hasDb && dbRow.bookable != null)) ? {
      bookable: pick(hasDb ? dbRow.bookable : null, baseBooking ? baseBooking.bookable === true : false) === true,
      order: pick(hasDb ? dbRow.bookingOrder : null, baseBooking ? baseBooking.order : null),
      priceType: pick(hasDb ? dbRow.priceType : null, baseBooking ? baseBooking.priceType : null),
      priceValue: pick(hasDb ? dbRow.priceValue : null, baseBooking ? baseBooking.priceValue : null),
      unitLabel: pick(hasDb ? dbRow.priceUnit : null, baseBooking ? baseBooking.unitLabel : null),
      // Paliers de tarif par jour et par creneau (migration 0043). Une ligne DB
      // sans paliers laisse parler le socle, comme les autres champs 0039.
      pricing: pick(hasDb ? dbRow.pricing : null, baseBooking ? baseBooking.pricing : null),
      // Caracteristiques d'INSTALLATION, pas de tarif : ce que le centre
      // precise au client (« 12 niveaux », « 2 pistes ») et ce que le
      // materiel accepte (5 joueurs sur le Fun Run). Socle uniquement pour
      // l'instant : le jour ou deux centres divergent la-dessus, elles
      // rejoindront la base comme l'a fait le tarif.
      note: baseBooking ? (baseBooking.note || null) : null,
      maxPax: baseBooking && baseBooking.maxPax != null ? Number(baseBooking.maxPax) : null,
      // Capacite de l'installation : combien d'unites, et lesquelles. Le
      // client n'a pas a lire « pistes 9 et 10 », mais le centre doit savoir
      // qu'il n'en a que deux.
      units: baseBooking && baseBooking.units != null ? Number(baseBooking.units) : null,
      // Joueurs de confort par unite (duckpin : 6 par piste). Une seule
      // source pour le compte de pistes, serveur ET tunnel (2026-08-24).
      capacityPerUnit: baseBooking && baseBooking.capacityPerUnit != null ? Number(baseBooking.capacityPerUnit) : null,
      unitIds: baseBooking && Array.isArray(baseBooking.unitIds) ? baseBooking.unitIds : null,
    } : null,
  };
}

// ── Reconstruction des DEUX formats depuis l'entree canonique ────────────────
// getFormulaDoc : format ops-knowledge/formulas.json (steps compris). Regle
// d'or : ne poser un champ optionnel QUE s'il est present dans le fichier
// d'origine (deep-equal exact avec getFormula d'avant le refactor).
function formulaDocFromCanonical(canonical) {
  const doc = {
    id: canonical.id,
    name: canonical.name,
    family: canonical.docFamily,
    minPax: canonical.minPax,
  };
  doc.price = { type: canonical.priceType, value: canonical.priceValue };
  if (canonical.priceOld != null) doc.price.oldValue = canonical.priceOld;
  if (canonical.notDuringHolidays) doc.notDuringHolidays = true;
  if (canonical.validDays && canonical.validDays.length) doc.validDays = canonical.validDays.slice();
  if (canonical.timeLimitMin != null || canonical.timeLimitMax != null) {
    doc.timeLimit = {};
    if (canonical.timeLimitMin != null) doc.timeLimit.min = minutesToHhmm(canonical.timeLimitMin);
    if (canonical.timeLimitMax != null) doc.timeLimit.max = minutesToHhmm(canonical.timeLimitMax);
  }
  if (canonical.orderPolicy != null) doc.orderPolicy = canonical.orderPolicy;
  if (canonical.orderConstraints && canonical.orderConstraints.length) {
    doc.orderConstraints = canonical.orderConstraints.map((pair) => pair.slice());
  }
  if (canonical.humanValidation != null) doc.humanValidation = canonical.humanValidation;
  doc.steps = canonical.steps.map((step) => {
    const out = { activityId: step.activityId, count: step.count };
    if (step.durationMinutes != null) out.durationMinutes = step.durationMinutes;
    if (step.label != null) out.label = step.label;
    if (step.critical) out.critical = true;
    if (step.resourceType != null) out.resourceType = step.resourceType;
    if (step.pax != null) out.pax = step.pax;
    if (step.optional) out.optional = true;
    return out;
  });
  return doc;
}

// Ce que la carte du tunnel AFFICHE pour une formule custom : l'admin ne saisit
// aucune ligne de description (createFormula n'en envoie pas), donc sans
// derivation la carte etait VIDE (nom + prix, zero contenu). La ligne se derive
// du step : son libelle s'il existe, sinon duree + nom d'activite du catalogue.
function describeStepForCard(step, activityNameById) {
  if (step.label) return step.label;
  const name = (activityNameById && activityNameById.get(step.activityId)) || step.activityId || 'Activite';
  const count = Math.max(1, Number(step.count) || 1);
  let duration = '';
  if (step.durationMinutes != null && Number(step.durationMinutes) > 0) {
    const m = Math.trunc(Number(step.durationMinutes));
    duration = m < 60 ? `${m} min` : (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`);
  }
  if (duration) return count > 1 ? `${count}x ${duration} de ${name}` : `${duration} de ${name}`;
  return count > 1 ? `${count}x ${name}` : name;
}

// getBookingFormule : format lib/booking-config FORMULES. hasBowling / bowlingDur
// DERIVES des steps. timeLimit en heures numeriques. noHolidays TOUJOURS present
// (le socle booking le porte sur chaque formule, contrairement a formulas.json).
// desc[] : les lignes saisies priment ; une formule custom sans lignes les
// derive de ses steps. Les formules du socle portent toutes leurs desc[], la
// derivation ne les touche donc jamais (deep-equal seed intact).
function bookingFromCanonical(canonical, activityNameById) {
  const formule = {
    id: canonical.id,
    name: canonical.name,
    family: canonical.bookingFamily,
    desc: canonical.descriptionLines.length
      ? canonical.descriptionLines.slice()
      : canonical.steps.filter((step) => step.activityId).map((step) => describeStepForCard(step, activityNameById)),
    price: canonical.priceValue,
    type: canonical.priceType,
    minPax: canonical.minPax,
  };
  if (canonical.priceOld != null) formule.oldPrice = canonical.priceOld;
  if (canonical.validDays && canonical.validDays.length) formule.validDays = canonical.validDays.slice();
  if (canonical.timeLimitMin != null || canonical.timeLimitMax != null) {
    formule.timeLimit = {};
    if (canonical.timeLimitMin != null) formule.timeLimit.min = canonical.timeLimitMin / 60;
    if (canonical.timeLimitMax != null) formule.timeLimit.max = canonical.timeLimitMax / 60;
  }
  formule.noHolidays = Boolean(canonical.notDuringHolidays);
  const bowling = canonical.steps.find((step) => step.activityId === 'bowling');
  formule.hasBowling = Boolean(bowling);
  if (bowling) formule.bowlingDur = bowling.durationMinutes != null ? bowling.durationMinutes / 60 : 1;
  if (canonical.best) formule.best = true;
  formule.notes = canonical.notes.slice();
  if (canonical.estimatedTotalDuration != null) formule.estimatedTotalDuration = canonical.estimatedTotalDuration;
  return formule;
}

function activityDocFromCanonical(canonical) {
  const doc = {
    id: canonical.id,
    name: canonical.name,
    resourceType: canonical.resourceType,
    durationModel: canonical.durationModel,
    serviceModel: canonical.serviceModel,
    riskDrivers: canonical.riskDrivers,
  };
  if (canonical.planningPressure != null) doc.planningPressure = canonical.planningPressure;
  // Meme regle d'or que pour les formules : ne poser un champ optionnel QUE
  // s'il a une valeur, sinon le deep-equal avec activities.json casse (assert
  // .deepStrictEqual distingue "clef absente" de "clef a null").
  if (canonical.booking) {
    const booking = { bookable: canonical.booking.bookable === true };
    if (canonical.booking.order != null) booking.order = canonical.booking.order;
    if (canonical.booking.priceType != null) booking.priceType = canonical.booking.priceType;
    if (canonical.booking.priceValue != null) booking.priceValue = canonical.booking.priceValue;
    if (canonical.booking.unitLabel != null) booking.unitLabel = canonical.booking.unitLabel;
    if (canonical.booking.pricing != null) booking.pricing = canonical.booking.pricing;
    if (canonical.booking.note != null) booking.note = canonical.booking.note;
    if (canonical.booking.maxPax != null) booking.maxPax = canonical.booking.maxPax;
    if (canonical.booking.units != null) booking.units = canonical.booking.units;
    if (canonical.booking.capacityPerUnit != null) booking.capacityPerUnit = canonical.booking.capacityPerUnit;
    if (canonical.booking.unitIds != null) booking.unitIds = canonical.booking.unitIds;
    doc.booking = booking;
  }
  return doc;
}

// ── Cache module ─────────────────────────────────────────────────────────────
// `centerClients` : la carte centre -> entreprise, lue dans le MEME
// rafraichissement que le catalogue (meme TTL, meme fail-soft). C'est elle qui
// permet aux accesseurs de rester SYNCHRONES tout en etant scopes : un appelant
// passe un centerId, le store en deduit l'entreprise.
let dbState = { formulas: [], steps: [], activities: [], centerClients: new Map() };
// Un catalogue fusionne PAR PORTEE (entreprise). Les portees se comptent sur les
// doigts d'une main : on les construit paresseusement et on les garde jusqu'au
// prochain applyCatalogState.
let mergedByScope = new Map();
let lastLoadedAt = 0;

// L'entreprise qui lit, deduite du centre. FAIL-CLOSED : un centre inconnu, vide
// ou orphelin ne lit QUE le catalogue plateforme, jamais celui d'un autre
// client. Meme doctrine que fallbackForSession (lib/center-scope) : mieux vaut
// une liste appauvrie qu'une fuite.
function resolveScopeForCenter(centerId) {
  const id = String(centerId == null ? '' : centerId).trim().toLowerCase();
  if (!id || id === PLATFORM_SCOPE) return PLATFORM_SCOPE;
  const client = dbState.centerClients.get(id);
  if (client) return normalizeScope(client);
  // Centre HORS carte alors que la carte est CHARGEE : portee dediee VIDE,
  // jamais la plateforme. Sinon un centre cree sans client_id (upsertCenter
  // n'ecrit pas cette colonne : l'orphelin est un clic de console plausible)
  // heritait du socle et VENDAIT les 14 formules Fun Galaxy a leurs prix
  // (mesure 2026-09-01). Carte VIDE = demarrage a froid / panne base : on
  // garde le repli plateforme documente par loadCatalogState (appauvri mais
  // jamais fuyant, personne d'autre n'existe alors non plus).
  if (dbState.centerClients.size > 0) return ORPHAN_CENTER_SCOPE;
  return PLATFORM_SCOPE;
}

// Parmi les lignes portant la meme cle, celle de l'entreprise PRIME sur celle de
// la plateforme. Une ligne d'une AUTRE entreprise n'est jamais candidate.
function pickForScope(rows, scope) {
  let platform = null;
  for (const row of rows) {
    const owner = normalizeScope(row.ownerClientId);
    if (owner === scope) return row;
    if (owner === PLATFORM_SCOPE) platform = row;
  }
  return platform;
}

function buildMergedForScope(scope) {
  // Le socle FICHIER n est servi qu a son proprietaire : pour toute autre
  // entreprise il n existe pas, et son catalogue se resume a ses lignes DB.
  const seedVisible = seedVisibleForScope(scope);
  // Lignes visibles par cette entreprise : les siennes et celles de la
  // plateforme. Tout le reste n'existe pas de son point de vue.
  const visibleFormulas = dbState.formulas.filter((row) => {
    const owner = normalizeScope(row.ownerClientId);
    return owner === scope || owner === PLATFORM_SCOPE;
  });
  const visibleActivities = dbState.activities.filter((row) => {
    const owner = normalizeScope(row.ownerClientId);
    return owner === scope || owner === PLATFORM_SCOPE;
  });

  const rowsById = new Map();
  for (const row of visibleFormulas) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, []);
    rowsById.get(row.id).push(row);
  }
  const dbFormulaById = new Map();
  for (const [id, rows] of rowsById) {
    const chosen = pickForScope(rows, scope);
    if (chosen) dbFormulaById.set(id, chosen);
  }

  // Les steps suivent la ligne RETENUE : les steps d'une entreprise ne
  // s'appliquent jamais a la formule plateforme d'une autre.
  const dbStepsByFormula = new Map();
  for (const step of dbState.steps) {
    const chosen = dbFormulaById.get(step.formulaId);
    if (!chosen) continue;
    if (normalizeScope(step.ownerClientId) !== normalizeScope(chosen.ownerClientId)) continue;
    if (!dbStepsByFormula.has(step.formulaId)) dbStepsByFormula.set(step.formulaId, []);
    dbStepsByFormula.get(step.formulaId).push(step);
  }

  const activityRowsByKey = new Map();
  for (const row of visibleActivities) {
    const key = `${row.id}|${row.centerId}`;
    if (!activityRowsByKey.has(key)) activityRowsByKey.set(key, []);
    activityRowsByKey.get(key).push(row);
  }
  const dbActivityByKey = new Map();
  for (const [key, rows] of activityRowsByKey) {
    const chosen = pickForScope(rows, scope);
    if (chosen) dbActivityByKey.set(key, chosen);
  }

  // Noms d'activites pour deriver les lignes de description d'une formule
  // custom (describeStepForCard). Priorite : ligne DB du catalogue commun
  // ('all'), sinon socle fichier, sinon ligne DB d'un centre (activite creee
  // pour un seul centre).
  const activityNameById = new Map();
  if (seedVisible) {
    for (const [id, base] of ACTIVITY_BASE_BY_ID) if (base && base.name) activityNameById.set(id, String(base.name));
  }
  for (const row of dbActivityByKey.values()) {
    if (row.active === false || !row.name) continue;
    if (row.centerId === DEFAULT_ACTIVITY_CENTER || !activityNameById.has(row.id)) activityNameById.set(row.id, String(row.name));
  }

  // Ordre : socle d'abord (ordre fichier), puis les formules custom (par
  // sort_index puis id) qui n'existent pas dans le socle.
  const orderedIds = seedVisible ? [...BASELINE_ORDER] : [];
  const customIds = [...dbFormulaById.values()]
    .filter((row) => !BOOKING_BASE_BY_ID.has(row.id) && !DOC_BASE_BY_ID.has(row.id))
    .sort((a, b) => {
      const sa = a.sortIndex == null ? Number.MAX_SAFE_INTEGER : a.sortIndex;
      const sb = b.sortIndex == null ? Number.MAX_SAFE_INTEGER : b.sortIndex;
      return sa - sb || (a.id < b.id ? -1 : 1);
    })
    .map((row) => row.id);
  for (const id of customIds) if (!orderedIds.includes(id)) orderedIds.push(id);

  const formulaDocById = new Map();
  const bookingFormuleById = new Map();
  const bookingList = [];

  for (const id of orderedIds) {
    const dbRow = dbFormulaById.get(id) || null;
    // active=false = retiree ; SANS ligne DB, on garde le socle (rien ne change).
    if (dbRow && dbRow.active === false) continue;
    const canonical = buildCanonicalFormula({
      id,
      bookingBase: seedVisible ? (BOOKING_BASE_BY_ID.get(id) || null) : null,
      docBase: seedVisible ? (DOC_BASE_BY_ID.get(id) || null) : null,
      dbRow,
      dbSteps: dbStepsByFormula.get(id) || null,
    });
    const doc = formulaDocFromCanonical(canonical);
    const booking = bookingFromCanonical(canonical, activityNameById);
    formulaDocById.set(id, doc);
    bookingFormuleById.set(id, booking);
    bookingList.push(booking);
  }

  // Activites : socle (center 'all') plus lignes DB visibles. Une cle (id, centerId).
  const activityDocByKey = new Map();
  const activityIds = new Set([
    ...(seedVisible ? [...ACTIVITY_BASE_BY_ID.keys()] : []),
    ...[...dbActivityByKey.values()].map((row) => row.id),
  ]);
  for (const id of activityIds) {
    const base = seedVisible ? (ACTIVITY_BASE_BY_ID.get(id) || null) : null;
    // Socle 'all' toujours disponible si aucune ligne DB ne le retire.
    const centers = new Set([DEFAULT_ACTIVITY_CENTER]);
    for (const row of dbActivityByKey.values()) if (row.id === id) centers.add(row.centerId);
    for (const centerId of centers) {
      const dbRow = dbActivityByKey.get(`${id}|${centerId}`) || null;
      if (dbRow && dbRow.active === false) continue;
      if (!dbRow && !base && centerId === DEFAULT_ACTIVITY_CENTER) continue;
      if (!dbRow && centerId !== DEFAULT_ACTIVITY_CENTER) continue;
      const canonical = buildCanonicalActivity({ id, centerId, base, dbRow });
      activityDocByKey.set(`${id}|${centerId}`, activityDocFromCanonical(canonical));
    }
  }

  // dbFormulaIds : l'ensemble des ids qui portent une LIGNE VISIBLE PAR CETTE
  // ENTREPRISE (active ou non). C'est ce qui distingue "id inconnu" (aucune
  // ligne -> fallback fichier legitime) de "id connu mais desactive" (ligne
  // active=false -> retiree pour de vrai, jamais de resurrection par le
  // fichier). Lu par isFormulaKnown. Scope par scope : la desactivation d'une
  // formule chez un client ne doit pas priver un autre client du socle.
  const dbFormulaIds = new Set(dbFormulaById.keys());

  return { formulaDocById, bookingFormuleById, bookingList, activityDocByKey, dbFormulaIds };
}

// Applique un etat DB (les 3 tables + la carte centre -> entreprise) et jette
// les catalogues fusionnes. Passer un etat vide restaure le socle. Testable
// directement (comme applyCenterOverrides dans lib/ops-knowledge).
function applyCatalogState(state = {}) {
  const centerClients = new Map();
  if (state.centerClients instanceof Map) {
    for (const [centerId, clientId] of state.centerClients) {
      if (centerId && clientId) centerClients.set(String(centerId).toLowerCase(), normalizeScope(clientId));
    }
  } else if (Array.isArray(state.centerClients)) {
    for (const row of state.centerClients) {
      const centerId = row && (row.id || row.centerId);
      const clientId = row && (row.client_id || row.clientId);
      if (centerId && clientId) centerClients.set(String(centerId).toLowerCase(), normalizeScope(clientId));
    }
  }
  dbState = {
    formulas: Array.isArray(state.formulas) ? state.formulas.map(normalizeFormulaRow) : [],
    steps: Array.isArray(state.steps) ? state.steps.map(normalizeStepRow) : [],
    activities: Array.isArray(state.activities) ? state.activities.map(normalizeActivityRow) : [],
    centerClients,
  };
  mergedByScope = new Map();
  return ensureMerged();
}

// Les colonnes de portee (0042) et de chainage (0041) sont detectees a la
// lecture : le code peut etre deploye AVANT la migration sans trou. Tant qu'une
// colonne manque, on retombe sur la forme historique et les ECRITURES restent
// historiques elles aussi (drapeaux dbHasOwnerScope / dbHasChainColumns).
async function loadCatalogState(pool) {
  const formulaSelect = (withChain, withScope) => `select id, name, family, min_pax, price_type, price_value, price_old,
              not_during_holidays, valid_days, time_limit_min_minutes, time_limit_max_minutes,
              human_validation, order_policy,${withChain ? ' order_constraints,' : ''} is_birthday_formula, best, description_lines,
              sort_index, source, active${withScope ? ', owner_client_id' : ''}
       from formulas;`;
  const stepSelect = (withChain, withScope) => `select formula_id, position, activity_id, count, duration_minutes, label, critical, resource_type${withChain ? ', pax, optional' : ''}${withScope ? ', owner_client_id' : ''}
       from formula_steps
       order by formula_id, position;`;
  const activitySelect = (withScope, withPricing) => `select id, center_id, name, resource_type, duration_model, service_model,
            risk_drivers, planning_pressure, bookable, price_type, price_value,
            price_unit, booking_order, source, active${withScope ? ', owner_client_id' : ''}${withPricing ? ', pricing' : ''}
     from activities;`;

  // SEULE l'absence d'une colonne declenche la retombee (code pg 42703,
  // undefined_column). Toute autre erreur (connexion, table absente, droit) se
  // propage : la masquer ferait passer une panne pour une base pre-migration.
  const attempt = async (withChain, withScope) => {
    const formulas = await pool.query(formulaSelect(withChain, withScope));
    const steps = await pool.query(stepSelect(withChain, withScope));
    // Le tarif par creneau se detecte a part : il est arrive apres la portee,
    // donc une base peut porter l'une sans l'autre.
    let activities;
    try {
      activities = await pool.query(activitySelect(withScope, true));
      dbHasActivityPricing = true;
    } catch (error) {
      if (!error || error.code !== '42703') throw error;
      dbHasActivityPricing = false;
      activities = await pool.query(activitySelect(withScope, false));
    }
    return { formulas, steps, activities, withChain, withScope };
  };
  const undefinedColumn = (error) => Boolean(error) && error.code === '42703';

  let loaded = null;
  for (const [withChain, withScope] of [[true, true], [true, false], [false, true], [false, false]]) {
    try {
      loaded = await attempt(withChain, withScope);
      break;
    } catch (error) {
      if (!undefinedColumn(error)) throw error;
    }
  }
  if (!loaded) throw new Error('Catalogue illisible : aucune forme de selection acceptee.');

  dbHasChainColumns = loaded.withChain;
  dbHasOwnerScope = loaded.withScope;

  // La carte centre -> entreprise. Fail-soft a part : sans elle, tout le monde
  // lit le catalogue plateforme, ce qui est appauvri mais jamais fuyant.
  let centerClients = [];
  try {
    const centers = await pool.query(`select id, client_id from centers;`);
    centerClients = centers.rows || [];
  } catch (error) {
    centerClients = [];
  }

  return {
    formulas: loaded.formulas.rows || [],
    steps: loaded.steps.rows || [],
    activities: loaded.activities.rows || [],
    centerClients,
  };
}

// Rafraichit le cache depuis la base (fail-soft, TTL 30 s). Meme mecanique que
// refreshCenterOverrides : sur erreur base on garde le dernier etat connu, le
// timestamp est pose avant la lecture pour throttler meme en cas d'echec.
async function refreshCatalog(pool, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastLoadedAt < OVERRIDE_TTL_MS) return false;
  lastLoadedAt = now;
  try {
    const state = await loadCatalogState(pool);
    applyCatalogState(state);
    return true;
  } catch (error) {
    // On garde le dernier etat connu (socle ou dernier chargement DB) : un
    // incident base ne doit pas changer le catalogue de facon impredictible.
    return false;
  }
}

// ── Adaptateurs SYNCHRONES (lus partout) ─────────────────────────────────────
// TOUS prennent un centerId : c'est lui qui porte la portee. Omis, ils rendent
// le catalogue PLATEFORME, jamais celui d'un client.
function ensureMerged(centerId) {
  const scope = resolveScopeForCenter(centerId);
  let hit = mergedByScope.get(scope);
  if (!hit) {
    hit = buildMergedForScope(scope);
    mergedByScope.set(scope, hit);
  }
  return hit;
}

// Format ops-knowledge/formulas.json. null si formule inconnue/retiree pour ce
// centre (le caller retombe alors sur le fichier, cf lib/ops-knowledge getFormula).
function getFormulaDoc(id, centerId) {
  return ensureMerged(centerId).formulaDocById.get(id) || null;
}

// RESOLUTION par id, toutes portees confondues. Reservee au cas « une
// reservation porte deja cet id, rends-moi son document » : ce n'est jamais une
// LISTE, et les ids de formules custom sont uniques a l'echelle de la
// plateforme (createFormula refuse un id deja pris, quelle que soit
// l'entreprise). Les surfaces publiques verifient toujours l'appartenance AVANT
// d'appeler (getEffectiveFormules(centerId).some(...)).
function resolveFormulaDocAnyScope(id) {
  for (const row of dbState.formulas) {
    if (row.id !== id) continue;
    const doc = ensureMergedForOwner(row.ownerClientId).formulaDocById.get(id);
    if (doc) return doc;
  }
  return ensureMerged().formulaDocById.get(id) || null;
}

// Meme doctrine que resolveFormulaDocAnyScope, au format lib/booking-config :
// resoudre UN id deja choisi (une reservation le porte, une etape le cite), pas
// lister. Les listes passent toutes par listBookingFormules(centerId).
function resolveBookingFormuleAnyScope(id) {
  for (const row of dbState.formulas) {
    if (row.id !== id) continue;
    const booking = ensureMergedForOwner(row.ownerClientId).bookingFormuleById.get(id);
    if (booking) return booking;
  }
  return ensureMerged().bookingFormuleById.get(id) || null;
}

// L'id porte-t-il une ligne, quelle que soit l'entreprise ? Complement de
// resolveBookingFormuleAnyScope pour le fix no-resurrect du meme chemin.
function isFormulaKnownAnyScope(id) {
  return dbState.formulas.some((row) => row.id === id);
}

function ensureMergedForOwner(ownerClientId) {
  const scope = normalizeScope(ownerClientId);
  let hit = mergedByScope.get(scope);
  if (!hit) {
    hit = buildMergedForScope(scope);
    mergedByScope.set(scope, hit);
  }
  return hit;
}

// Format lib/booking-config FORMULES.
function getBookingFormule(id, centerId) {
  return ensureMerged(centerId).bookingFormuleById.get(id) || null;
}

// Liste des formules actives au format booking, dans l'ordre du socle.
function listBookingFormules(centerId) {
  return ensureMerged(centerId).bookingList.slice();
}

// Format ops-knowledge/activities.json. Prefere la ligne du centre, sinon 'all',
// sinon le socle. null si activite inconnue/retiree.
function getActivityDoc(id, centerId = DEFAULT_ACTIVITY_CENTER) {
  const store = ensureMerged(centerId);
  if (centerId && centerId !== DEFAULT_ACTIVITY_CENTER) {
    const own = store.activityDocByKey.get(`${id}|${centerId}`);
    if (own) return own;
  }
  return store.activityDocByKey.get(`${id}|${DEFAULT_ACTIVITY_CENTER}`) || null;
}

// Catalogue effectif d'un centre : une entree par id, la ligne du centre primant
// sur 'all'. Trie par booking.order (les non ordonnees en fin, par id). C'est la
// vue bas niveau ; le filtre "ce centre la propose-t-il vraiment" et les
// blocages du jour vivent dans lib/activity-catalog.js.
function listActivities(centerId = DEFAULT_ACTIVITY_CENTER) {
  const store = ensureMerged(centerId);
  const byId = new Map();
  for (const [key, doc] of store.activityDocByKey) {
    const [id, docCenter] = key.split('|');
    if (docCenter !== DEFAULT_ACTIVITY_CENTER && docCenter !== centerId) continue;
    // La ligne du centre prime sur 'all' : on n'ecrase jamais une specificite
    // de centre par le catalogue commun, quel que soit l'ordre d'iteration.
    if (byId.has(id) && docCenter === DEFAULT_ACTIVITY_CENTER) continue;
    byId.set(id, doc);
  }
  return [...byId.values()].sort((a, b) => {
    const oa = a.booking && a.booking.order != null ? a.booking.order : Number.MAX_SAFE_INTEGER;
    const ob = b.booking && b.booking.order != null ? b.booking.order : Number.MAX_SAFE_INTEGER;
    return oa - ob || (a.id < b.id ? -1 : 1);
  });
}

// Cette activite occupe-t-elle une ressource que le planning compte (piste,
// arene) ? C'est LA frontiere du produit : tout le reste se reserve sans jamais
// contraindre un creneau.
function isPlannedActivity(activityIdOrDoc, centerId = DEFAULT_ACTIVITY_CENTER) {
  const doc = typeof activityIdOrDoc === 'string' ? getActivityDoc(activityIdOrDoc, centerId) : activityIdOrDoc;
  return Boolean(doc && PLANNED_RESOURCE_TYPES.has(doc.resourceType));
}

// L'id porte-t-il une LIGNE VISIBLE PAR CE CENTRE (active OU desactivee) ?
// C'est le signal du fix "no-resurrect" (residuel 2a n1) : un caller
// (lib/ops-knowledge getFormula, lib/booking-config catalogBookingFormule) ne
// retombe sur le FICHIER que si l'id est INCONNU du store. Un id CONNU mais
// desactive (getFormulaDoc rend null ET isFormulaKnown rend true) est retire
// pour de vrai, sans fallback. SCOPE : la desactivation chez un client ne prive
// jamais un autre client du socle.
function isFormulaKnown(id, centerId) {
  return ensureMerged(centerId).dbFormulaIds.has(id);
}

// Une activite (par id, tous centres de CETTE entreprise confondus) est-elle
// presente dans le catalogue effectif ? Sert a valider un step : un activityId
// doit exister dans le catalogue activites OU porter un resourceType explicite
// (pseudo-activites service_drinks / arcade_credit, absentes du catalogue mais
// typees a la main).
function isActivityKnown(activityId, centerId) {
  return activityKnownIn(ensureMerged(centerId), activityId);
}

// Meme question, posee depuis le chemin d'ECRITURE : la ou l'appelant tient la
// portee de l'entreprise (createFormula, setFormulaSteps) et non un centre.
function isActivityKnownForScope(activityId, ownerClientId) {
  return activityKnownIn(ensureMergedForOwner(ownerClientId), activityId);
}

function activityKnownIn(store, activityId) {
  const id = String(activityId || '');
  for (const key of store.activityDocByKey.keys()) {
    const sep = key.indexOf('|');
    if (sep !== -1 && key.slice(0, sep) === id) return true;
  }
  return false;
}

// Initialisation depuis le socle des le chargement du module (comme
// DEFAULT_CENTER_CONFIG_BY_ID dans lib/center-config) : le store est utilisable
// avant tout refreshCatalog, avec le comportement fichier.
applyCatalogState({});

// ─────────────────────────────────────────────────────────────────────────────
// CRUD DU CATALOGUE DB (phase 2b-1). Ecritures BORNEES + validees, exportees.
//
// DOCTRINE preservee : ces fonctions n'ecrivent QUE dans les 3 tables (formulas
// / formula_steps / activities). Sans ecriture, le socle fichier reste la
// verite (scripts/catalog-store-check.js). Toute ecriture rafraichit le cache
// (refreshCatalog force) pour que les adaptateurs synchrones voient l'etat neuf.
//
// SCOPE (assume, documente) : les formulas sont GLOBALES (pas de center_id). Ce
// CRUD edite donc le catalogue PARTAGE (owner + client agissent dessus). Le
// scoping per-centre des formules custom est un raffinement ulterieur, HORS
// phase. Les ACTIVITES portent deja un center_id (defaut 'all').
// ─────────────────────────────────────────────────────────────────────────────

const FORMULA_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const NAME_MAX = 120;
const PRICE_MIN = 0;
const PRICE_MAX = 1000;

function exposeError(message) {
  const error = new Error(message);
  error.expose = true; // message metier sur, montrable au client (comme catalog-overrides)
  return error;
}

function toBool(value) {
  return value === true || value === 'true';
}

function validateName(value, required) {
  if (value === null || value === undefined || value === '') {
    if (required) throw exposeError('Nom requis.');
    return null;
  }
  const name = String(value).trim();
  if (!name) {
    if (required) throw exposeError('Nom requis.');
    return null;
  }
  if (name.length > NAME_MAX) throw exposeError(`Nom trop long (max ${NAME_MAX} caracteres).`);
  return name;
}

function validateFamily(value) {
  if (value === null || value === undefined || value === '') return 'Formules speciales';
  const family = String(value).trim();
  if (family.length > NAME_MAX) throw exposeError(`Famille trop longue (max ${NAME_MAX} caracteres).`);
  return family;
}

function validateMinPax(value) {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) throw exposeError('minPax invalide (entier >= 1).');
  return parsed;
}

function validatePriceType(value) {
  const type = String(value == null ? '' : value).trim();
  if (type !== 'per_pax' && type !== 'per_lane') throw exposeError('priceType invalide (per_pax ou per_lane).');
  return type;
}

function validatePrice(value, label, { nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw exposeError(`${label} requis.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < PRICE_MIN || parsed > PRICE_MAX) {
    throw exposeError(`${label} hors bornes (attendu ${PRICE_MIN} a ${PRICE_MAX}).`);
  }
  return Math.round(parsed * 100) / 100;
}

function validateValidDays(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Array.isArray(value)) throw exposeError('validDays doit etre une liste de jours (0..6).');
  const days = value.map((day) => Math.trunc(Number(day)));
  for (const day of days) {
    if (!Number.isFinite(day) || day < 0 || day > 6) throw exposeError('validDays invalide (chaque jour 0..6).');
  }
  return days.length ? days : null;
}

function validateTimeLimit(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1440) {
    throw exposeError(`${label} invalide (0..1440 minutes depuis minuit).`);
  }
  return parsed;
}

function validateShortText(value, label, max = 60) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw exposeError(`${label} trop long (max ${max} caracteres).`);
  return text;
}

function validateDescriptionLines(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw exposeError('descriptionLines doit etre une liste de lignes.');
  if (value.length > 40) throw exposeError('Trop de lignes de description (max 40).');
  return value.map((line) => String(line).slice(0, 200));
}

// Valide et normalise une liste de steps. Chaque step doit designer une activite
// CONNUE du catalogue OU porter un resourceType explicite (pseudo-activites).
function validateSteps(steps, ownerClientId) {
  if (!Array.isArray(steps) || !steps.length) throw exposeError('Une formule doit comporter au moins une etape.');
  return steps.map((step, index) => {
    const source = step && typeof step === 'object' ? step : {};
    const activityId = source.activityId == null ? '' : String(source.activityId).trim();
    const resourceType = source.resourceType == null ? '' : String(source.resourceType).trim();
    if (!activityId && !resourceType) throw exposeError(`Etape ${index + 1} : activityId ou resourceType requis.`);
    if (activityId && !resourceType && !isActivityKnownForScope(activityId, ownerClientId)) {
      throw exposeError(`Etape ${index + 1} : activite inconnue "${activityId}" (fournir un resourceType explicite pour une pseudo-activite).`);
    }
    const count = source.count == null ? 1 : Math.trunc(Number(source.count));
    if (!Number.isFinite(count) || count < 1 || count > 99) throw exposeError(`Etape ${index + 1} : count invalide (1..99).`);
    let durationMinutes = null;
    if (source.durationMinutes != null && source.durationMinutes !== '') {
      durationMinutes = Math.trunc(Number(source.durationMinutes));
      if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
        throw exposeError(`Etape ${index + 1} : duree invalide (0..1440 minutes).`);
      }
    }
    let pax = null;
    if (source.pax != null && source.pax !== '') {
      // Sans les colonnes 0041, la valeur ne vivrait qu'en memoire et un
      // restart la perdrait en silence : on REFUSE plutot que de perdre.
      if (!dbHasChainColumns) {
        throw exposeError(`Etape ${index + 1} : l'effectif par etape exige la migration 0041 (colonne formula_steps.pax absente de la base).`);
      }
      pax = Math.trunc(Number(source.pax));
      if (!Number.isFinite(pax) || pax < 1 || pax > 240) {
        throw exposeError(`Etape ${index + 1} : effectif invalide (1..240 joueurs).`);
      }
    }
    if (source.optional === true && !dbHasChainColumns) {
      throw exposeError(`Etape ${index + 1} : l'etape optionnelle exige la migration 0041 (colonne formula_steps.optional absente de la base).`);
    }
    return {
      activityId: activityId || null,
      count,
      durationMinutes,
      label: source.label == null ? null : String(source.label).slice(0, 200),
      critical: source.critical === true,
      resourceType: resourceType || null,
      pax,
      optional: source.optional === true,
    };
  });
}

function stepRowFor(formulaId, position, step, ownerClientId) {
  return {
    owner_client_id: normalizeScope(ownerClientId),
    formula_id: formulaId,
    position,
    activity_id: step.activityId,
    count: step.count,
    duration_minutes: step.durationMinutes,
    label: step.label,
    critical: step.critical,
    resource_type: step.resourceType,
    pax: step.pax == null ? null : step.pax,
    optional: step.optional === true,
  };
}

function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function makeUniqueId(baseSlug, taken) {
  let root = baseSlug && /^[a-z]/.test(baseSlug) ? baseSlug : `x-${baseSlug}`.replace(/-+$/, '');
  if (!root || !/^[a-z]/.test(root)) root = 'formule';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function normalizeActivityCenter(value) {
  const center = String(value == null ? DEFAULT_ACTIVITY_CENTER : value).trim().toLowerCase();
  return center || DEFAULT_ACTIVITY_CENTER;
}

// Contrainte d'ordre fournie par l'API : normalisee, et REFUSEE tant que la
// base ne porte pas la colonne 0041 (sinon l'etat memoire la porterait et un
// restart la perdrait en silence).
function validateOrderConstraintsInput(value) {
  const normalized = normalizeOrderConstraints(value);
  if (normalized && !dbHasChainColumns) {
    throw exposeError("La contrainte d'ordre exige la migration 0041 (colonne formulas.order_constraints absente de la base).");
  }
  return normalized;
}

// Champs valides d'une formule au format table (snake_case), depuis l'input API.
function buildFormulaFields(input) {
  return {
    name: validateName(input.name, true),
    family: validateFamily(input.family),
    min_pax: validateMinPax(input.minPax),
    price_type: validatePriceType(input.priceType),
    price_value: validatePrice(input.priceValue, 'Prix', { nullable: false }),
    price_old: validatePrice(input.priceOld, 'Ancien prix', { nullable: true }),
    not_during_holidays: toBool(input.notDuringHolidays),
    valid_days: validateValidDays(input.validDays),
    time_limit_min_minutes: validateTimeLimit(input.timeLimitMinMinutes, 'Heure min'),
    time_limit_max_minutes: validateTimeLimit(input.timeLimitMaxMinutes, 'Heure max'),
    human_validation: validateShortText(input.humanValidation, 'humanValidation'),
    order_policy: validateShortText(input.orderPolicy, 'orderPolicy'),
    order_constraints: validateOrderConstraintsInput(input.orderConstraints),
    is_birthday_formula: toBool(input.isBirthdayFormula),
    best: toBool(input.best),
    description_lines: validateDescriptionLines(input.descriptionLines),
  };
}

// Patch PARTIEL d'une formule (mute une ligne snake_case en place). Seuls les
// champs fournis sont touches ; undefined = garder. Ne touche PAS les steps.
function applyFormulaPatch(row, input) {
  if (input.name !== undefined) row.name = validateName(input.name, true);
  if (input.family !== undefined) row.family = validateFamily(input.family);
  if (input.minPax !== undefined) row.min_pax = validateMinPax(input.minPax);
  if (input.priceType !== undefined) row.price_type = validatePriceType(input.priceType);
  if (input.priceValue !== undefined) row.price_value = validatePrice(input.priceValue, 'Prix', { nullable: false });
  if (input.priceOld !== undefined) row.price_old = validatePrice(input.priceOld, 'Ancien prix', { nullable: true });
  if (input.notDuringHolidays !== undefined) row.not_during_holidays = toBool(input.notDuringHolidays);
  if (input.validDays !== undefined) row.valid_days = validateValidDays(input.validDays);
  if (input.timeLimitMinMinutes !== undefined) row.time_limit_min_minutes = validateTimeLimit(input.timeLimitMinMinutes, 'Heure min');
  if (input.timeLimitMaxMinutes !== undefined) row.time_limit_max_minutes = validateTimeLimit(input.timeLimitMaxMinutes, 'Heure max');
  if (input.humanValidation !== undefined) row.human_validation = validateShortText(input.humanValidation, 'humanValidation');
  if (input.orderPolicy !== undefined) row.order_policy = validateShortText(input.orderPolicy, 'orderPolicy');
  if (input.orderConstraints !== undefined) row.order_constraints = validateOrderConstraintsInput(input.orderConstraints);
  if (input.isBirthdayFormula !== undefined) row.is_birthday_formula = toBool(input.isBirthdayFormula);
  if (input.best !== undefined) row.best = toBool(input.best);
  if (input.descriptionLines !== undefined) row.description_lines = validateDescriptionLines(input.descriptionLines);
}

// Ligne formulas (snake_case) reconstruite depuis le SOCLE fichier, pour patcher
// une formule seed qui n'a PAS encore de ligne DB (prod deja backfillee, mais on
// reste robuste). Le resultat est identique a ce que le backfill aurait ecrit.
function canonicalToFormulaRow(canonical, ownerClientId) {
  return {
    id: canonical.id,
    owner_client_id: normalizeScope(ownerClientId),
    name: canonical.name,
    family: canonical.docFamily,
    min_pax: canonical.minPax,
    price_type: canonical.priceType,
    price_value: canonical.priceValue,
    price_old: canonical.priceOld,
    not_during_holidays: canonical.notDuringHolidays === true,
    valid_days: canonical.validDays && canonical.validDays.length ? canonical.validDays.slice() : null,
    time_limit_min_minutes: canonical.timeLimitMin,
    time_limit_max_minutes: canonical.timeLimitMax,
    human_validation: canonical.humanValidation,
    order_policy: canonical.orderPolicy,
    order_constraints: canonical.orderConstraints || null,
    is_birthday_formula: canonical.isBirthday === true,
    best: canonical.best === true,
    description_lines: canonical.descriptionLines ? canonical.descriptionLines.slice() : [],
    sort_index: canonical.sortIndex,
    source: canonical.source,
    active: canonical.active,
  };
}

function baselineFormulaRow(id, ownerClientId) {
  const bookingBase = BOOKING_BASE_BY_ID.get(id) || null;
  const docBase = DOC_BASE_BY_ID.get(id) || null;
  if (!bookingBase && !docBase) return null;
  const canonical = buildCanonicalFormula({ id, bookingBase, docBase, dbRow: null, dbSteps: null });
  return canonicalToFormulaRow(canonical, ownerClientId);
}

function baselineActivityRow(id, centerId, ownerClientId) {
  const base = ACTIVITY_BASE_BY_ID.get(id) || null;
  if (!base || centerId !== DEFAULT_ACTIVITY_CENTER) return null;
  const booking = (base.booking && typeof base.booking === 'object') ? base.booking : null;
  return {
    id,
    owner_client_id: normalizeScope(ownerClientId),
    center_id: DEFAULT_ACTIVITY_CENTER,
    name: base.name != null ? base.name : null,
    resource_type: base.resourceType != null ? base.resourceType : null,
    duration_model: base.durationModel != null ? base.durationModel : null,
    service_model: base.serviceModel != null ? base.serviceModel : null,
    risk_drivers: Array.isArray(base.riskDrivers) ? base.riskDrivers.slice() : null,
    planning_pressure: base.planningPressure != null ? base.planningPressure : null,
    bookable: booking && booking.bookable != null ? Boolean(booking.bookable) : null,
    price_type: booking && booking.priceType != null ? String(booking.priceType) : null,
    price_value: booking && booking.priceValue != null ? Number(booking.priceValue) : null,
    price_unit: booking && booking.unitLabel != null ? String(booking.unitLabel) : null,
    booking_order: booking && booking.order != null ? Math.trunc(Number(booking.order)) : null,
    source: 'seed',
    active: true,
  };
}

// ── SQL borne (memes shapes que scripts/backfill-catalog.js) ─────────────────
// Un seul constructeur d'UPSERT pour les trois tables du catalogue. Il remplace
// les branches recopiees a la main (une par combinaison de migration appliquee)
// qui divergeaient des qu'une colonne s'ajoutait : la liste des colonnes est
// desormais calculee A PARTIR des drapeaux de capacite, et le SQL en decoule.
function buildUpsert(table, columns, conflictColumns) {
  const placeholders = columns.map((column, index) => (column.cast ? `$${index + 1}::${column.cast}` : `$${index + 1}`));
  const updates = columns
    .filter((column) => !conflictColumns.includes(column.name))
    .map((column) => `${column.name} = excluded.${column.name}`);
  const sql = `insert into ${table}
       (${columns.map((column) => column.name).join(', ')}, updated_at)
     values (${placeholders.join(',')}, now())
     on conflict (${conflictColumns.join(', ')}) do update set
       ${updates.join(',\n       ')},
       updated_at = now();`;
  return { sql, values: columns.map((column) => column.value) };
}

// La portee n'entre dans le SQL que si la base la porte (migration 0042). Avant
// application, les ecritures restent STRICTEMENT historiques.
function scopeColumn(row) {
  return dbHasOwnerScope ? [{ name: 'owner_client_id', value: normalizeScope(row.owner_client_id) }] : [];
}
function scopeConflict(base) {
  return dbHasOwnerScope ? [...base, 'owner_client_id'] : base;
}

async function writeFormulaRow(db, row) {
  const columns = [
    { name: 'id', value: row.id },
    { name: 'name', value: row.name },
    { name: 'family', value: row.family },
    { name: 'min_pax', value: row.min_pax },
    { name: 'price_type', value: row.price_type },
    { name: 'price_value', value: row.price_value },
    { name: 'price_old', value: row.price_old },
    { name: 'not_during_holidays', value: row.not_during_holidays },
    { name: 'valid_days', value: row.valid_days },
    { name: 'time_limit_min_minutes', value: row.time_limit_min_minutes },
    { name: 'time_limit_max_minutes', value: row.time_limit_max_minutes },
    { name: 'human_validation', value: row.human_validation },
    { name: 'order_policy', value: row.order_policy },
    // Colonne 0041 : absente avant application, la contrainte d'ordre est deja
    // refusee en amont (validateOrderConstraintsInput).
    ...(dbHasChainColumns
      ? [{ name: 'order_constraints', cast: 'jsonb', value: row.order_constraints == null ? null : JSON.stringify(row.order_constraints) }]
      : []),
    { name: 'is_birthday_formula', value: row.is_birthday_formula },
    { name: 'best', value: row.best },
    { name: 'description_lines', value: row.description_lines },
    { name: 'sort_index', value: row.sort_index },
    { name: 'source', value: row.source },
    { name: 'active', value: row.active },
    // La portee est ajoutee EN FIN de liste : les positions des colonnes
    // historiques ne bougent pas, donc les doubles de test qui lisent les
    // parametres par index restent justes.
    ...scopeColumn(row),
  ];
  const { sql, values } = buildUpsert('formulas', columns, scopeConflict(['id']));
  await db.query(sql, values);
}

async function writeStepRow(db, row) {
  const columns = [
    { name: 'formula_id', value: row.formula_id },
    { name: 'position', value: row.position },
    { name: 'activity_id', value: row.activity_id },
    { name: 'count', value: row.count },
    { name: 'duration_minutes', value: row.duration_minutes },
    { name: 'label', value: row.label },
    { name: 'critical', value: row.critical },
    { name: 'resource_type', value: row.resource_type },
    ...(dbHasChainColumns
      ? [
        { name: 'pax', value: row.pax == null ? null : row.pax },
        { name: 'optional', value: row.optional === true },
      ]
      : []),
    ...scopeColumn(row),
  ];
  // formula_steps n'a pas de colonne updated_at : buildUpsert en pose une, donc
  // cette table garde son SQL propre.
  const names = columns.map((column) => column.name);
  const placeholders = columns.map((column, index) => `$${index + 1}`);
  const conflict = scopeConflict(['formula_id', 'position']);
  const updates = names
    .filter((name) => !conflict.includes(name))
    .map((name) => `${name} = excluded.${name}`);
  await db.query(
    `insert into formula_steps
       (${names.join(', ')})
     values (${placeholders.join(',')})
     on conflict (${conflict.join(', ')}) do update set
       ${updates.join(',\n       ')};`,
    columns.map((column) => column.value),
  );
}

// Retire les steps d'une formule POUR UNE PORTEE : effacer ceux d'un autre
// client serait exactement la fuite que la migration 0042 ferme.
async function deleteStepRows(db, formulaId, ownerClientId) {
  if (dbHasOwnerScope) {
    await db.query(
      `delete from formula_steps where formula_id = $1 and owner_client_id = $2;`,
      [formulaId, normalizeScope(ownerClientId)],
    );
    return;
  }
  await db.query(`delete from formula_steps where formula_id = $1;`, [formulaId]);
}

async function writeActivityRow(db, row) {
  const columns = [
    { name: 'id', value: row.id },
    { name: 'center_id', value: row.center_id },
    { name: 'name', value: row.name },
    { name: 'resource_type', value: row.resource_type },
    { name: 'duration_model', cast: 'jsonb', value: row.duration_model == null ? null : JSON.stringify(row.duration_model) },
    { name: 'service_model', cast: 'jsonb', value: row.service_model == null ? null : JSON.stringify(row.service_model) },
    { name: 'risk_drivers', value: row.risk_drivers },
    { name: 'planning_pressure', value: row.planning_pressure },
    { name: 'bookable', value: row.bookable === undefined ? null : row.bookable },
    { name: 'price_type', value: row.price_type === undefined ? null : row.price_type },
    { name: 'price_value', value: row.price_value === undefined ? null : row.price_value },
    { name: 'price_unit', value: row.price_unit === undefined ? null : row.price_unit },
    { name: 'booking_order', value: row.booking_order === undefined ? null : row.booking_order },
    { name: 'source', value: row.source },
    { name: 'active', value: row.active },
    ...scopeColumn(row),
    ...(dbHasActivityPricing
      ? [{ name: 'pricing', cast: 'jsonb', value: row.pricing == null ? null : JSON.stringify(row.pricing) }]
      : []),
  ];
  const { sql, values } = buildUpsert('activities', columns, scopeConflict(['id', 'center_id']));
  await db.query(sql, values);
}

// La ligne d'une formule POUR UNE PORTEE. Sans la portee dans le predicat, un
// client patcherait la ligne d'un autre : c'est la fuite B du 2026-08-20.
async function readFormulaRowById(pool, id, ownerClientId) {
  const columns = `id, name, family, min_pax, price_type, price_value, price_old, not_during_holidays,
            valid_days, time_limit_min_minutes, time_limit_max_minutes, human_validation, order_policy,
            is_birthday_formula, best, description_lines, sort_index, source, active`;
  const result = dbHasOwnerScope
    ? await pool.query(
      `select ${columns}, owner_client_id
     from formulas where id = $1 and owner_client_id = $2 limit 1;`,
      [id, normalizeScope(ownerClientId)],
    )
    : await pool.query(
      `select ${columns}
     from formulas where id = $1 limit 1;`,
      [id],
    );
  return (result.rows && result.rows[0]) || null;
}

async function readFormulaIds(pool) {
  const result = await pool.query(`select id from formulas;`);
  return new Set((result.rows || []).map((row) => row.id));
}

async function readActivityRowByKey(pool, id, centerId, ownerClientId) {
  const columns = `id, center_id, name, resource_type, duration_model, service_model, risk_drivers, planning_pressure,
            bookable, price_type, price_value, price_unit, booking_order, source, active${dbHasActivityPricing ? ', pricing' : ''}`;
  const result = dbHasOwnerScope
    ? await pool.query(
      `select ${columns}, owner_client_id
     from activities where id = $1 and center_id = $2 and owner_client_id = $3 limit 1;`,
      [id, centerId, normalizeScope(ownerClientId)],
    )
    : await pool.query(
      `select ${columns}
     from activities where id = $1 and center_id = $2 limit 1;`,
      [id, centerId],
    );
  return (result.rows && result.rows[0]) || null;
}

async function readActivityIds(pool) {
  const result = await pool.query(`select id from activities;`);
  return new Set((result.rows || []).map((row) => row.id));
}

// GARDE DE PORTEE (migration 0042). Elle n'a pas besoin d'exister comme
// fonction : les trois ecritures ci-dessous font deja une lecture FRAICHE et
// SCOPEE (readFormulaRowById(pool, id, owner)). Si cette lecture ne rend rien et
// que l'id n'est pas dans le SOCLE fichier, la formule appartient a quelqu'un
// d'autre, et le refus tombe tout seul : « Formule inconnue ». Ce message ne
// revele jamais l'existence de l'offre d'un autre client.
//
// Une formule du SOCLE, elle, reste editable par tous : l'ecriture cree la ligne
// de CETTE entreprise (copie a la volee), le socle et les autres clients ne
// bougent pas.

// Les drapeaux de capacite (colonnes 0041 et 0042) se decouvrent A LA LECTURE,
// dans loadCatalogState. Une ECRITURE qui arrive avant toute lecture emettrait
// donc un SQL de la mauvaise forme : constate le 2026-08-20 sur un script de
// configuration, « there is no unique or exclusion constraint matching the ON
// CONFLICT specification », parce que le upsert visait (id, center_id) alors
// que la cle primaire en porte trois. Au bord des API le probleme n'existe pas
// (refreshCatalog est appele a chaque requete), mais un appelant direct n'a
// aucune raison de le savoir : chaque point d'ecriture s'en assure lui-meme.
async function ensureCapabilities(pool) {
  if (lastLoadedAt) return;
  await refreshCatalog(pool, { force: true });
}

// ── FORMULES ─────────────────────────────────────────────────────────────────

// Insere une formule source='custom' active=true + ses steps (position
// sequentielle) dans une transaction. Genere un id slug si absent (unique) ;
// refuse un id qui collisionne un seed. Bornes : name<=120, prix 0..1000,
// minPax>=1, steps non vide.
// ---- LES RESSOURCES PLANIFIABLES D UN NOUVEAU CLIENT ------------------------
//
// Le socle ne se prete plus (voir FILE_SEED_OWNER_CLIENT_ID), donc un client
// neuf n a AUCUNE activite : il ne peut meme pas creer une formule « 1 partie
// de bowling », validateSteps refusant une activite inconnue de sa portee.
//
// Ces trois ids ne sont pas des offres commerciales de Fun Galaxy : ce sont les
// RESSOURCES que le moteur sait planifier (une piste, une arene, une table).
// Un centre qui declare 8 pistes vend du bowling, c est une evidence du produit,
// pas un heritage. On les copie donc DANS SON catalogue a lui, avec son
// owner_client_id : sa ligne, son nom, ses prix, modifiables sans toucher a
// personne. Tout le reste (minigolf, karting VR, golf o Clock, fun run...)
// reste chez son proprietaire et ne suit jamais.
const PLANNABLE_SEED_ACTIVITY_IDS = ['bowling', 'laser_game', 'party_table'];

async function seedPlannableActivitiesForClient(pool, { ownerClientId, resources = {} } = {}) {
  const owner = normalizeScope(ownerClientId);
  if (!owner || owner === PLATFORM_SCOPE || owner === FILE_SEED_OWNER_CLIENT_ID) return [];
  const wanted = PLANNABLE_SEED_ACTIVITY_IDS.filter((id) => {
    if (id === 'bowling') return Number(resources?.bowling?.laneCount) > 0;
    if (id === 'laser_game') return Number(resources?.laser?.weaponCount) > 0;
    return Boolean(resources?.partyTables);
  });
  const copied = [];
  for (const id of wanted) {
    const existing = await readActivityRowByKey(pool, id, DEFAULT_ACTIVITY_CENTER, owner);
    if (existing) continue;
    const row = baselineActivityRow(id, DEFAULT_ACTIVITY_CENTER, owner);
    if (!row) continue;
    await writeActivityRow(pool, row);
    copied.push(id);
  }
  if (copied.length) await refreshCatalog(pool, { force: true });
  return copied;
}

async function createFormula(pool, input = {}) {
  await ensureCapabilities(pool);
  const owner = normalizeScope(input.ownerClientId);
  const fields = buildFormulaFields(input);
  const steps = validateSteps(input.steps, owner);

  const seedIds = new Set([...BOOKING_BASE_BY_ID.keys(), ...DOC_BASE_BY_ID.keys()]);
  const dbIds = await readFormulaIds(pool);
  let id;
  if (input.id != null && String(input.id).trim()) {
    id = String(input.id).trim().toLowerCase();
    if (!FORMULA_ID_PATTERN.test(id)) throw exposeError('Identifiant formule invalide (minuscules, chiffres, tirets, commence par une lettre).');
    if (seedIds.has(id)) throw exposeError('Cet identifiant est reserve a une formule du socle.');
    if (dbIds.has(id)) throw exposeError('Une formule porte deja cet identifiant.');
  } else {
    id = makeUniqueId(slugify(input.name), new Set([...seedIds, ...dbIds]));
  }

  const row = { id, owner_client_id: owner, ...fields, sort_index: null, source: 'custom', active: true };
  const stepRows = steps.map((step, index) => stepRowFor(id, index, step, owner));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeFormulaRow(client, row);
    for (const stepRow of stepRows) await writeStepRow(client, stepRow);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await refreshCatalog(pool, { force: true });
  return { id, ownerClientId: owner, source: 'custom', stepCount: stepRows.length };
}

// Patch partiel des champs de la formule (PAS les steps). Autorise sur seed ET
// custom : une formule seed sans ligne DB est materialisee depuis le socle.
// Une entreprise ne peut toucher qu au catalogue QU ELLE VOIT. Depuis que le
// socle appartient a son client (FILE_SEED_OWNER_CLIENT_ID), une autre
// entreprise n a plus aucun titre sur f1 ou MATIN MALIN : sans cette garde,
// baselineFormulaRow lui en fabriquait une copie que PERSONNE n affichait
// ensuite (un id du socle n entre ni dans l ordre du socle, ni dans les
// customs). L ecriture repondait 200 et ne changeait rien de visible, ce qui
// est pire qu un refus.
function assertFormulaInScope(id, ownerClientId) {
  const owner = normalizeScope(ownerClientId);
  if (seedVisibleForScope(owner)) return;
  if (ensureMergedForOwner(owner).formulaDocById.has(id)) return;
  throw exposeError('Cette formule ne fait pas partie du catalogue de cette entreprise.');
}

async function updateFormula(pool, input = {}) {
  await ensureCapabilities(pool);
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const owner = normalizeScope(input.ownerClientId);
  assertFormulaInScope(id, owner);
  const existing = await readFormulaRowById(pool, id, owner);
  const row = existing ? { ...existing, owner_client_id: owner } : baselineFormulaRow(id, owner);
  if (!row) throw exposeError('Formule inconnue.');
  applyFormulaPatch(row, input);
  await writeFormulaRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, ownerClientId: owner, source: row.source };
}

// Remplace la liste ORDONNEE des steps d'une formule (delete + insert dans une
// transaction). C'est l'edition des ACTIVITES d'une formule. Une formule seed
// sans ligne DB est materialisee d'abord (sinon les steps DB seraient ignores :
// buildCanonicalFormula n'utilise dbSteps que si la formule a une ligne DB).
async function setFormulaSteps(pool, input = {}) {
  await ensureCapabilities(pool);
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const owner = normalizeScope(input.ownerClientId);
  assertFormulaInScope(id, owner);
  const existing = await readFormulaRowById(pool, id, owner);
  const baseRow = existing ? null : baselineFormulaRow(id, owner);
  // Ni ligne dans MA portee, ni socle fichier : la formule est celle d'un autre.
  if (!existing && !baseRow) throw exposeError('Formule inconnue.');
  const steps = validateSteps(input.steps, owner);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (baseRow) await writeFormulaRow(client, baseRow);
    await deleteStepRows(client, id, owner);
    for (let index = 0; index < steps.length; index += 1) {
      await writeStepRow(client, stepRowFor(id, index, steps[index], owner));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await refreshCatalog(pool, { force: true });
  return { id, stepCount: steps.length };
}

// SOFT delete : active=false, JAMAIS de DELETE physique (reservations.formule_id
// n'a pas de FK mais les resas passees gardent leur libelle). Le fix no-resurrect
// (isFormulaKnown) garantit qu'une seed desactivee ne reapparait pas par le fichier.
async function deleteFormula(pool, input = {}) {
  await ensureCapabilities(pool);
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant formule requis.');
  const owner = normalizeScope(input.ownerClientId);
  assertFormulaInScope(id, owner);
  const existing = await readFormulaRowById(pool, id, owner);
  const row = existing ? { ...existing, owner_client_id: owner } : baselineFormulaRow(id, owner);
  if (!row) throw exposeError('Formule inconnue.');
  row.active = false;
  await writeFormulaRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, ownerClientId: owner, active: false };
}

// ── ACTIVITES ────────────────────────────────────────────────────────────────
// Tarif d'activite : positif, borne, deux decimales. Une chaine vide ou null
// EFFACE le tarif (retour a "regle sur place") au lieu de valoir zero : zero est
// un prix, l'absence de prix n'en est pas un.
function validateActivityPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw exposeError('Tarif invalide (nombre positif attendu).');
  if (parsed > 100000) throw exposeError('Tarif hors bornes.');
  return Math.round(parsed * 100) / 100;
}

// Paliers de tarif d'une activite. Refuses tant que la migration 0043 n'est pas
// appliquee : sans la colonne, ils ne vivraient qu'en memoire et un redemarrage
// les perdrait en silence. Meme doctrine que l'effectif par etape (0041).
function validateActivityPricing(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = normalizeActivityPricing(value);
  if (!normalized) throw exposeError('Paliers de tarif invalides (mode per_person, et chaque palier borne par des jours ou une plage horaire).');
  if (!dbHasActivityPricing) {
    throw exposeError("Le tarif par creneau exige la migration 0043 (colonne activities.pricing absente de la base).");
  }
  return normalized;
}

function validateActivityPriceType(value) {
  const text = validateShortText(value, 'priceType', 30);
  if (text == null || text === '') return null;
  if (!ACTIVITY_PRICE_TYPES.has(text)) throw exposeError(`Type de tarif inconnu (${[...ACTIVITY_PRICE_TYPES].join(', ')}).`);
  return text;
}

// LA REGLE DE SURETE des paliers (lib/activity-pricing.js, en tete) : le prix
// affiche avant le choix du creneau est le prix de BASE, donc un palier ne
// peut que le BAISSER. Un palier au-dessus ferait MONTER le total au choix de
// l heure : surprise vers le haut, la seule direction interdite. On verifie le
// COUPLE effectif (base, paliers) a chaque ecriture, dans les deux sens :
// poser un palier trop haut, ou abaisser la base sous un palier existant.
// Base non chiffree (regle sur place) : rien a comparer, les paliers font foi.
function assertPricingUnderBase(pricing, priceValue) {
  if (!pricing || !Array.isArray(pricing.tiers)) return;
  // null/vide = pas de base chiffree (regle sur place), PAS une base a zero :
  // Number(null) vaut 0 et refuserait tout palier d une activite sans prix.
  if (priceValue === null || priceValue === undefined || priceValue === '') return;
  const base = Number(priceValue);
  if (!Number.isFinite(base)) return;
  const audessus = pricing.tiers.find((tier) => Number(tier.price) > base);
  if (audessus) {
    throw exposeError(`Un palier (${audessus.price} EUR) depasse le prix de base (${base} EUR) : le prix annonce avant le creneau ne peut que baisser.`);
  }
}

function buildActivityFields(input) {
  const fields = {
    name: validateName(input.name, true),
    resource_type: validateShortText(input.resourceType, 'resourceType', 60),
    duration_model: input.durationModel != null && typeof input.durationModel === 'object' ? input.durationModel : null,
    service_model: input.serviceModel != null && typeof input.serviceModel === 'object' ? input.serviceModel : null,
    risk_drivers: Array.isArray(input.riskDrivers) ? input.riskDrivers.map(String) : null,
    planning_pressure: validateShortText(input.planningPressure, 'planningPressure', 30),
    bookable: input.bookable === undefined ? null : Boolean(input.bookable),
    price_type: validateActivityPriceType(input.priceType),
    price_value: validateActivityPrice(input.priceValue),
    price_unit: validateShortText(input.priceUnit, 'priceUnit', 60),
    pricing: validateActivityPricing(input.pricing),
    booking_order: input.bookingOrder === undefined || input.bookingOrder === null || input.bookingOrder === ''
      ? null
      : Math.trunc(Number(input.bookingOrder)) || null,
  };
  assertPricingUnderBase(fields.pricing, fields.price_value);
  return fields;
}

function applyActivityPatch(row, input) {
  if (input.name !== undefined) row.name = validateName(input.name, true);
  if (input.resourceType !== undefined) row.resource_type = validateShortText(input.resourceType, 'resourceType', 60);
  if (input.durationModel !== undefined) row.duration_model = input.durationModel != null && typeof input.durationModel === 'object' ? input.durationModel : null;
  if (input.serviceModel !== undefined) row.service_model = input.serviceModel != null && typeof input.serviceModel === 'object' ? input.serviceModel : null;
  if (input.riskDrivers !== undefined) row.risk_drivers = Array.isArray(input.riskDrivers) ? input.riskDrivers.map(String) : null;
  if (input.planningPressure !== undefined) row.planning_pressure = validateShortText(input.planningPressure, 'planningPressure', 30);
  if (input.bookable !== undefined) row.bookable = input.bookable === null ? null : Boolean(input.bookable);
  if (input.priceType !== undefined) row.price_type = validateActivityPriceType(input.priceType);
  if (input.priceValue !== undefined) row.price_value = validateActivityPrice(input.priceValue);
  if (input.priceUnit !== undefined) row.price_unit = validateShortText(input.priceUnit, 'priceUnit', 60);
  if (input.pricing !== undefined) row.pricing = validateActivityPricing(input.pricing);
  if (input.bookingOrder !== undefined) {
    row.booking_order = input.bookingOrder === null || input.bookingOrder === ''
      ? null
      : Math.trunc(Number(input.bookingOrder)) || null;
  }
  assertPricingUnderBase(row.pricing, row.price_value);
}

async function createActivity(pool, input = {}) {
  await ensureCapabilities(pool);
  const centerId = normalizeActivityCenter(input.centerId);
  const owner = normalizeScope(input.ownerClientId);
  const fields = buildActivityFields(input);
  const seedIds = new Set(ACTIVITY_BASE_BY_ID.keys());
  let id;
  if (input.id != null && String(input.id).trim()) {
    id = String(input.id).trim().toLowerCase();
    if (!FORMULA_ID_PATTERN.test(id)) throw exposeError('Identifiant activite invalide (minuscules, chiffres, tirets, commence par une lettre).');
    if (centerId === DEFAULT_ACTIVITY_CENTER && seedIds.has(id)) throw exposeError('Cet identifiant est reserve a une activite du socle.');
    if (await readActivityRowByKey(pool, id, centerId, owner)) throw exposeError('Une activite porte deja cet identifiant pour ce centre.');
  } else {
    id = makeUniqueId(slugify(input.name), new Set([...seedIds, ...(await readActivityIds(pool))]));
  }
  const row = { id, center_id: centerId, owner_client_id: owner, ...fields, source: 'custom', active: true };
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, ownerClientId: owner, source: 'custom' };
}

async function updateActivity(pool, input = {}) {
  await ensureCapabilities(pool);
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant activite requis.');
  const centerId = normalizeActivityCenter(input.centerId);
  const owner = normalizeScope(input.ownerClientId);
  const existing = await readActivityRowByKey(pool, id, centerId, owner);
  const row = existing ? { ...existing, owner_client_id: owner } : baselineActivityRow(id, centerId, owner);
  if (!row) throw exposeError('Activite inconnue.');
  applyActivityPatch(row, input);
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, ownerClientId: owner, source: row.source };
}

async function deleteActivity(pool, input = {}) {
  await ensureCapabilities(pool);
  const id = input && input.id != null ? String(input.id).trim().toLowerCase() : '';
  if (!id) throw exposeError('Identifiant activite requis.');
  const centerId = normalizeActivityCenter(input.centerId);
  const owner = normalizeScope(input.ownerClientId);
  const existing = await readActivityRowByKey(pool, id, centerId, owner);
  const row = existing ? { ...existing, owner_client_id: owner } : baselineActivityRow(id, centerId, owner);
  if (!row) throw exposeError('Activite inconnue.');
  row.active = false;
  await writeActivityRow(pool, row);
  await refreshCatalog(pool, { force: true });
  return { id, centerId, ownerClientId: owner, active: false };
}

module.exports = {
  refreshCatalog,
  seedPlannableActivitiesForClient,
  PLANNABLE_SEED_ACTIVITY_IDS,
  applyCatalogState,
  loadCatalogState,
  resolveFormulaDocAnyScope,
  resolveBookingFormuleAnyScope,
  isFormulaKnownAnyScope,
  isActivityKnownForScope,
  getFormulaDoc,
  getBookingFormule,
  listBookingFormules,
  getActivityDoc,
  listActivities,
  isPlannedActivity,
  isFormulaKnown,
  isActivityKnown,
  createFormula,
  updateFormula,
  setFormulaSteps,
  deleteFormula,
  createActivity,
  updateActivity,
  deleteActivity,
};
