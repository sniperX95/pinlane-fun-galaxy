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

// L ACCUEIL (2026-10-01, Movsar : « apres 5 minutes, et faut que ce soit no
// code pour eux, dans Etablissement ») : a partir de combien de minutes sans
// arrivee pointee un groupe passe « En retard » dans la console (liste du
// planning, Terrain, accueil). 0 = des la minute pile.
const DEFAULT_ACCUEIL = { lateThresholdMinutes: 5 };
function normalizeAccueil(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    lateThresholdMinutes: clampInt(src.lateThresholdMinutes, 0, 60, DEFAULT_ACCUEIL.lateThresholdMinutes),
  };
}

const STATUS_VALUES = new Set(['active', 'planned', 'closed']);
const LASER_RISK_VALUES = new Set(['critical', 'managed', 'low']);
const CENTER_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
// Une fermeture peut DEBORDER SUR LE LENDEMAIN. N4 Bowling ferme a 1 h le
// vendredi et 2 h le samedi : ces heures s'ecrivent 25:00 et 26:00, notation
// standard en hotellerie et en loisirs. Le sens : la soiree du samedi
// APPARTIENT au samedi, pour le staff comme pour le planning, meme quand elle
// finit dimanche matin. Le client, lui, lit une heure de montre (01:00) : la
// conversion est un habillage d'AFFICHAGE, jamais un changement de donnee.
// Borne haute a 30:00 (6 h du matin) : au-dela, c'est une erreur de saisie.
const TIME_PATTERN = /^(?:[0-2][0-9]|30):[0-5][0-9]$/;
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
    // null = grille historique par piste et par duree. Aucun centre existant ne
    // porte cette cle, donc aucun ne change de comportement.
    pricing: normalizeBowlingPricing(input.pricing),
  };
}

// TARIF DU BOWLING PAR CENTRE (2026-08-20).
//
// Historiquement le bowling se vend PAR PISTE ET PAR DUREE, via la grille
// BOWLING_PRICES de lib/booking-config (39 EUR l'heure la piste). C'est le
// modele de Fun Galaxy, et il ne bouge pas : `pricing` absent ou null = grille
// historique, au centime pres.
//
// N4 Bowling vend PAR PERSONNE ET PAR PARTIE, avec un prix qui depend du jour
// (6 EUR la partie du mercredi au jeudi, 7 EUR du vendredi au dimanche, la 2e
// partie moins chere). Ce modele existait deja dans le produit, pour le laser
// (LASER_GAME_OPTIONS : games, price, durationMinutes, prix multiplie par le
// nombre de joueurs). On le donne au bowling, en DONNEE DE CENTRE.
//
// FORME :
//   { mode: 'per_game_per_person',
//     minutesPerGame: 60,
//     tiers: [ { days:[3,4], prices:[6, 11] }, { days:[5,6,0], prices:[7, 13] } ] }
// `prices` porte le prix CUMULE par personne : l'index 0 vaut 1 partie,
// l'index 1 vaut 2 parties. C'est ce que le client PAIE, donc ce qui ne peut
// pas se contredire. La longueur de `prices` borne le nombre de parties
// vendables en ligne : un centre qui n'affiche que la 1re et la 2e partie ne
// vend pas trois parties sans l'avoir decide.
const BOWLING_PRICING_MODES = new Set(['per_game_per_person']);

function normalizeBowlingPricing(input) {
  if (!isPlainObject(input)) return null;
  if (!BOWLING_PRICING_MODES.has(input.mode)) return null;
  const minutesPerGame = clampInt(input.minutesPerGame, 10, 240, 60);
  // UNE PARTIE NE DURE PAS UN TEMPS FIXE : elle dure ce que mettent les joueurs
  // a lancer chacun leur tour. Verbatim Movsar pour N4 : « c'est 10 min par
  // personne pour une partie en moyenne ». Quand cette valeur est posee, elle
  // PRIME sur minutesPerGame : la duree se calcule alors sur les joueurs de la
  // piste la plus chargee, pas sur le groupe entier (deux pistes jouent en
  // parallele, elles ne s'additionnent pas). 0 = duree fixe, comportement
  // d'avant.
  const minutesPerPlayerPerGame = clampInt(input.minutesPerPlayerPerGame, 0, 60, 0);
  const rawTiers = Array.isArray(input.tiers) ? input.tiers : [];
  const tiers = [];
  const seenDays = new Set();
  for (const tier of rawTiers) {
    if (!isPlainObject(tier)) continue;
    const days = Array.from(new Set((Array.isArray(tier.days) ? tier.days : [])
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6)))
      // Un jour ne peut relever que d'UN palier : sinon deux prix coexistent
      // pour la meme journee et c'est le premier lu qui gagne, en silence.
      .filter((value) => !seenDays.has(value));
    if (!days.length) continue;
    const prices = (Array.isArray(tier.prices) ? tier.prices : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
      .map((value) => Math.round(value * 100) / 100)
      .slice(0, 6);
    if (!prices.length) continue;
    days.forEach((value) => seenDays.add(value));
    days.sort((a, b) => a - b);
    tiers.push({ days, prices });
  }
  if (!tiers.length) return null;
  return { mode: input.mode, minutesPerGame, minutesPerPlayerPerGame, tiers: tiers.slice(0, 7) };
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
  // Une fermeture avant l'ouverture ne produit AUCUN creneau (la boucle de
  // grille va de open a close) : la journee passerait pour ouverte tout en
  // n'offrant rien. Une nuit qui deborde s'ecrit 25:00, pas 01:00.
  const minutes = (value) => {
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  };
  if (minutes(close) <= minutes(open)) return undefined;
  return { open, close };
}

// UNE SAISIE REFUSEE NE DOIT PAS DEVENIR UN SILENCE (2026-08-31).
// Quand un jour etait PRESENT dans la saisie mais invalide, sa cle etait
// purement supprimee. La sauvegarde repondait "Configuration enregistree" sans
// un mot ; la cle absente n ecrasant plus rien, la fusion retombait sur la
// baseline. Mesure : le gerant ecrit son samedi "22:00 -> 02:00" (comme il le
// dit, alors que le code attend 26:00), la console affiche ensuite le samedi
// "Ferme", et le tunnel public continue de vendre l ANCIEN horaire. Deux
// verites opposees dans le meme produit, et personne pour le dire au gerant.
//
// La severite ne vaut QUE sur le chemin de SAUVEGARDE (strict). En LECTURE, la
// normalisation reste tolerante : une ligne deja stockee avec un jour bancal
// doit continuer de se charger, sinon un enregistrement ancien fermerait la
// console au lieu d afficher ce qu il peut.
const DAY_LABELS = {
  0: 'dimanche', 1: 'lundi', 2: 'mardi', 3: 'mercredi',
  4: 'jeudi', 5: 'vendredi', 6: 'samedi',
};

function scheduleError(day) {
  const error = new Error(`Horaire invalide pour ${DAY_LABELS[day] || `le jour ${day}`} : indiquez une ouverture ET une fermeture, la fermeture apres l'ouverture. Une nuit qui deborde s'ecrit au-dela de 24:00 (par exemple 26:00 pour 2 h du matin), jamais 02:00.`);
  error.expose = true;
  return error;
}

function normalizeScheduleBlock(block, strict = false) {
  if (!isPlainObject(block)) return undefined;
  const out = {};
  for (const day of SCHEDULE_DAYS) {
    if (!(day in block)) continue;
    const normalized = normalizeDaySchedule(block[day]);
    if (normalized === undefined) {
      if (strict) throw scheduleError(day);
      continue;
    }
    out[day] = normalized;
  }
  return out;
}

function normalizeSchedule(input, strict = false) {
  // Sentinel strings ("same_as_libramont_public_schedule", "to_confirm") are kept
  // as-is: they are resolved elsewhere and are not staff-editable time grids.
  if (typeof input === 'string') return input;
  if (!isPlainObject(input)) return undefined;
  const out = {};
  if ('regular' in input) {
    const regular = normalizeScheduleBlock(input.regular, strict);
    if (regular !== undefined) out.regular = regular;
  }
  if ('holiday' in input) {
    const holiday = normalizeScheduleBlock(input.holiday, strict);
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

// LES INSTALLATIONS DE CHAQUE ACTIVITE, REGLEES PAR LE CENTRE (2026-09-28).
// Movsar : « si jamais ya 8 tables de billards ... que depuis le saas on peut
// choisir combien de table dispo etc pour tout et que ca corrige a la seconde
// sur le formulaire ». { [activityId]: { units, capacityPerUnit } } : le nombre
// d installations (tables, pistes de duckpin, 1 a 50) et, quand l activite en
// a une, la capacite de chacune (joueurs par piste, 1 a 500). Une valeur
// absente laisse parler le socle (ops-knowledge/activities.json) ; une cle ou
// une valeur illisible est JETEE, jamais devinee. Lu par
// lib/activity-catalog (listSellableActivities), donc par le tunnel, la
// disponibilite, la garde de dotation et la console.
const CAPACITY_ACTIVITY_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CAPACITY_MAX_ENTRIES = 30;
function normalizeActivityCapacity(input) {
  if (!isPlainObject(input)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const id = String(key || '').trim().toLowerCase();
    if (!CAPACITY_ACTIVITY_ID.test(id) || !isPlainObject(value)) continue;
    const entree = {};
    const units = Math.trunc(Number(value.units));
    if (Number.isFinite(units) && units >= 1) entree.units = Math.min(50, units);
    const capacite = Math.trunc(Number(value.capacityPerUnit));
    if (Number.isFinite(capacite) && capacite >= 1) entree.capacityPerUnit = Math.min(500, capacite);
    // Le plafond d UNE reservation (5 tables de billard) : meme borne que le
    // compte d unites.
    const plafond = Math.trunc(Number(value.maxPerBooking));
    if (Number.isFinite(plafond) && plafond >= 1) entree.maxPerBooking = Math.min(50, plafond);
    if (!Object.keys(entree).length) continue;
    out[id] = entree;
    if (Object.keys(out).length >= CAPACITY_MAX_ENTRIES) break;
  }
  return out;
}

// LA DEMANDE SUR MESURE, OBLIGATOIRE A PARTIR DE N PERSONNES (2026-09-28).
// Movsar : « tout groupe superieur a 30 donc a partir 31 tout groupe sera
// redirige vers une demande sur mesure ... et ca sera gere directement par
// notre equipe ». { fromPax } : le premier effectif qui ne se reserve plus en
// ligne, de 2 a 240 (la borne des reservations en ligne) ; null = jamais. Une
// valeur illisible vaut null : la garde ne s invente jamais un seuil. Lu par
// la garde de public-reservations, le catalogue public et la page
// Etablissement, qui le regle.
const CUSTOM_REQUEST_MAX_FROM_PAX = 240;
function normalizeCustomRequest(input) {
  const brut = isPlainObject(input) ? input.fromPax : undefined;
  const n = brut === null || brut === '' ? NaN : Math.trunc(Number(brut));
  return { fromPax: Number.isFinite(n) && n >= 2 ? Math.min(CUSTOM_REQUEST_MAX_FROM_PAX, n) : null };
}
// Le seuil d un centre tel que le moteur le lit (fichier socle fusionne avec
// la config de la base, ou config normalisee d un centre ne en base).
function customRequestFromPax(center) {
  return normalizeCustomRequest(center && center.customRequest).fromPax;
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
// glow : la couleur du halo des boutons « neon » (le site de Fun Galaxy
// borde ses pilules d'un halo turquoise distinct du violet d'accent).
// Une deuxieme couleur de marque, pas une variante de la premiere.
const BRANDING_KEYS = ['accent', 'accentStrong', 'accentSoft', 'accentContrast', 'glow'];

// L IMAGE PAR ACTIVITE du composeur telephone (2026-08-25) : une photo par
// activite, DONNEE de centre comme la couleur (le produit n embarque
// l image d aucun client). Chemin d assets du depot ou https, tout le
// reste est jete.
const ACTIVITY_IMAGE_URL = /^(?:https:\/\/[^\s"'<>]+|\.?\/?assets\/[a-z0-9_/.-]+)$/i;
const ACTIVITY_IMAGE_ID = /^[a-z0-9_-]{1,40}$/;
const ACTIVITY_IMAGE_MAX = 12;

function normalizeActivityImages(input) {
  if (!isPlainObject(input)) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const id = String(key || '').trim().toLowerCase();
    const url = String(value || '').trim();
    if (!ACTIVITY_IMAGE_ID.test(id)) continue;
    if (url.length > 300 || !ACTIVITY_IMAGE_URL.test(url)) continue;
    out[id] = url;
    if (Object.keys(out).length >= ACTIVITY_IMAGE_MAX) break;
  }
  return Object.keys(out).length ? out : null;
}

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
  // 'neon' : la MATIERE des panneaux quand le centre a une deuxieme couleur
  // de marque. Un anneau net (pas une floraison) de la couleur `glow`, dans la
  // MEME direction de lumiere que les boutons neon, plus un lisere interne
  // clair. Ce n est pas une variante d ombre : c est le seul choix de panneau
  // qui utilise la seconde couleur.
  cards: ['line', 'flat', 'shadow', 'neon'],
  buttons: ['pill', 'rounded', 'neon'],
};

// LE MODE D'ENCAISSEMENT DU CENTRE (2026-08-18). Liste blanche VOLONTAIREMENT
// reduite a 'onsite' : le produit n'a aucun prestataire de paiement (aucun
// Stripe/Mollie/Payconiq dans le depot, source d'autorite : README). Les modes
// en ligne ('deposit', 'online') N'ENTRENT ICI QUE le jour ou l'encaissement
// existe : ecrire un mode que le produit ne tient pas, c'est la classe d'ecart
// commercial payee le 2026-08-08 (l'acompte fantome de la vitrine). L'ecran
// Etablissement les montre desactives, marques « a venir ».
const PAYMENT_MODES = ['onsite'];

function normalizePayment(input) {
  if (!isPlainObject(input)) return null;
  const mode = String(input.mode || '').trim().toLowerCase();
  if (!PAYMENT_MODES.includes(mode)) return null;
  return { mode };
}

// L INTERRUPTEUR DU FORMULAIRE INSTALLE CHEZ LE CLIENT.
//
// Le parcours Pinlane vit dans une iframe sur le site du centre, a la place de
// leur ancien formulaire. Le jour ou quelque chose cloche un dimanche a 15 h,
// personne ne veut chercher les identifiants WordPress de l agence : ce reglage
// rend l ancien formulaire en un clic, depuis Pinlane, sans toucher a leur site.
//
// ACTIF PAR DEFAUT, et le defaut est un choix : un centre qui n a jamais ouvert
// ce reglage garde exactement le comportement d aujourd hui. C est la valeur
// FAUSSE qui doit etre ecrite explicitement, jamais l absence de valeur qui
// coupe : un reglage manquant ne doit pas pouvoir eteindre un formulaire.
function normalizeEmbed(input) {
  if (!isPlainObject(input)) return { actif: true };
  const out = { actif: input.actif === false ? false : true };
  const quand = String(input.bascule || '').trim();
  const qui = String(input.basculePar || '').trim().slice(0, 80);
  // Qui a coupe et quand : sans ca, un centre revenu a son ancien formulaire
  // reste un mystere jusqu a ce que quelqu un s en apercoive.
  if (quand && !Number.isNaN(Date.parse(quand))) out.bascule = quand;
  if (qui) out.basculePar = qui;
  return out;
}

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
  const activityImages = normalizeActivityImages(input.activityImages);
  if (!light && !dark && !style && !activityImages) return null;
  return { ...(light || {}), ...(style || {}), ...(activityImages ? { activityImages } : {}), ...(dark ? { dark } : {}) };
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
    activityCapacity: normalizeActivityCapacity(center.activityCapacity) || {},
    customRequest: normalizeCustomRequest(center.customRequest),
    holidaySettings: normalizeHolidaySettings(center.holidaySettings),
    offerAvailability: normalizeOfferAvailability(center.offerAvailability),
    classification: normalizeClassification(center.classification),
    accueil: normalizeAccueil(center.accueil),
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
      activityCapacity: {},
      customRequest: normalizeCustomRequest(null),
      holidaySettings: normalizeHolidaySettings(null),
      offerAvailability: {},
      classification: normalizeClassification(null),
      accueil: normalizeAccueil(null),
      customActivities: [],
      branding: null,
      identity: null,
    };
}

// Validate + bound a (possibly partial) config against the center baseline.
// Always returns a coherent, fully-bounded config. Never throws on bad input.
function normalizeCenterConfig(input, baseId, options = {}) {
  const strict = Boolean(options && options.strict);
  const base = baseConfigFor(baseId);
  const merged = mergeCenterConfig(base, isPlainObject(input) ? input : {});
  const config = {
    status: STATUS_VALUES.has(merged.status) ? merged.status : base.status,
    timezone: String(merged.timezone || base.timezone || 'Europe/Brussels').trim() || 'Europe/Brussels',
    resources: normalizeResources(merged.resources || {}),
    activityAvailability: normalizeActivityAvailability(merged.activityAvailability) || {},
    activityCapacity: normalizeActivityCapacity(merged.activityCapacity) || {},
    customRequest: normalizeCustomRequest(merged.customRequest),
    holidaySettings: normalizeHolidaySettings(merged.holidaySettings),
    offerAvailability: normalizeOfferAvailability(merged.offerAvailability),
    classification: normalizeClassification(merged.classification),
    accueil: normalizeAccueil(merged.accueil),
    customActivities: normalizeCustomActivities(merged.customActivities),
    branding: normalizeBranding(merged.branding),
    identity: normalizeIdentity(merged.identity),
    payment: normalizePayment(merged.payment),
    embed: normalizeEmbed(merged.embed),
  };
  const schedule = normalizeSchedule(merged.defaultSchedule, strict);
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
  // strict : une saisie d horaire refusee revient au gerant avec la raison,
  // au lieu de disparaitre sous un "Configuration enregistree".
  const normalized = normalizeCenterConfig(mergedInput, id, { strict: true });
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
      activityCapacity: config.activityCapacity,
      customRequest: config.customRequest,
      holidaySettings: config.holidaySettings,
      offerAvailability: config.offerAvailability,
      classification: config.classification,
      accueil: config.accueil,
      customActivities: config.customActivities,
      branding: config.branding,
      identity: config.identity,
      payment: config.payment,
    };
  });
}

module.exports = {
  DEFAULT_CENTER_CONFIG_BY_ID,
  FALLBACK_BOWLING,
  DEFAULT_CLASSIFICATION,
  normalizeClassification,
  DEFAULT_ACCUEIL,
  normalizeAccueil,
  normalizeCustomActivities,
  normalizeActivityCapacity,
  normalizeCustomRequest,
  customRequestFromPax,
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
