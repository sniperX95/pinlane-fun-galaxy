// La RESSOURCE DECLAREE : une entite de DONNEES par centre, plus une constante
// de code.
//
// POURQUOI CE MODULE
//
// Le moteur ne connaissait que trois familles de ressources, cablees dans des
// ensembles figes (CRITICAL_RESOURCE_TYPES dans ops-engine, PLANNED_RESOURCE_TYPES
// dans catalog-store / activity-catalog) avec une regle sur mesure par famille.
// Ouvrir un centre de padel ou de paintball exigeait donc un deploiement. Ici,
// un centre DECLARE ses installations comme une donnee de sa config
// (centers.settings.config.resources.declared), au meme endroit que laneCount ou
// weaponCount : aucune migration, aucun deploiement, l'ecran Etablissement
// suffit.
//
// LE MODELE : un POOL d'installations interchangeables.
//   id               identifiant stable (slug), reference par les activites
//                    (resourceType d'une etape / d'une activite du catalogue).
//   name             nom lisible par le staff ("Court de padel").
//   units            nombre d'installations interchangeables (2 courts).
//   capacityPerUnit  joueurs par installation et par session (4 par court).
//   cleanupMinutes   temps de remise en etat entre deux occupations d'une
//                    installation (0 a 240 min).
//   allowGroupMixing deux groupes DISTINCTS peuvent-ils partager la meme
//                    session (meme fenetre exacte) sur une installation, dans
//                    la limite de sa capacite ? (le modele du laser partage).
//
// Ce pool generalise exactement les trois familles historiques (8 pistes x 6
// joueurs sans mixage ; 1 lancement x 30 armes avec mixage ; 8 tables), mais les
// trois familles GARDENT leur code dedie : le client reel ne doit voir aucune
// difference. Le pool ne gouverne que les ressources declarees par la donnee.
//
// Zero dependance : fonctions pures sur un objet centre. C'est ce qui permet a
// center-config (normalisation), ops-engine (allocation) et aux gates (FakePool)
// de partager LA meme verite sans cycle de require.

const MAX_DECLARED_RESOURCES = 20;
const DECLARED_ID_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;

// Types que la donnee ne peut PAS revendiquer : les trois familles historiques
// (leur semantique est cablee et testee ailleurs) et les pseudo-types de service
// du moteur (jamais des ressources comptees).
const RESERVED_RESOURCE_TYPES = new Set([
  'bowling_lane',
  'laser_arena',
  'party_table',
  'bar_service',
  'bar_service_then_autonomous',
  'soft_capacity',
  'free_activity',
  'transition',
  'service',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function slugifyResourceId(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

// Normalise UNE declaration. Rend null si la declaration est irrecuperable
// (pas de nom, id reserve) : on ne devine jamais une ressource.
function normalizeDeclaredResource(input) {
  if (!isPlainObject(input)) return null;
  const name = String(input.name || input.label || '').trim().slice(0, 60);
  let id = String(input.id || '').trim().toLowerCase();
  if (!DECLARED_ID_PATTERN.test(id)) id = slugifyResourceId(name);
  if (!id || !DECLARED_ID_PATTERN.test(id) || RESERVED_RESOURCE_TYPES.has(id)) return null;
  if (!name) return null;
  return {
    id,
    name,
    units: clampInt(input.units, 1, 50, 1),
    capacityPerUnit: clampInt(input.capacityPerUnit, 1, 500, 1),
    cleanupMinutes: clampInt(input.cleanupMinutes, 0, 240, 0),
    allowGroupMixing: input.allowGroupMixing === true || input.allowGroupMixing === 'true',
  };
}

// Normalise la LISTE (bornee, dedupliquee par id, ordre conserve). C'est la
// forme stockee dans centers.settings.config.resources.declared, et la forme
// lue par le moteur : une seule verite.
function normalizeDeclaredResources(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const normalized = normalizeDeclaredResource(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
    if (out.length >= MAX_DECLARED_RESOURCES) break;
  }
  return out;
}

// Les ressources declarees d'un centre, deja normalisees. Fail-safe : une
// config absente ou malformee rend [], jamais une exception (le moteur doit
// planifier meme si la declaration est vide).
function listDeclaredResources(center) {
  return normalizeDeclaredResources(center?.resources?.declared);
}

function getDeclaredResource(center, resourceType) {
  if (!resourceType) return null;
  return listDeclaredResources(center).find((resource) => resource.id === resourceType) || null;
}

function isDeclaredResourceType(center, resourceType) {
  return Boolean(getDeclaredResource(center, resourceType));
}

// Combien d'installations un groupe consomme sur ce pool. Meme logique que les
// pistes de bowling : un groupe plus grand qu'une installation s'etale sur
// plusieurs, jamais de fraction.
function requiredUnitsFor(resource, pax) {
  const players = Math.max(1, Math.trunc(Number(pax) || 1));
  const capacity = Math.max(1, Number(resource?.capacityPerUnit) || 1);
  return Math.ceil(players / capacity);
}

module.exports = {
  MAX_DECLARED_RESOURCES,
  RESERVED_RESOURCE_TYPES,
  getDeclaredResource,
  isDeclaredResourceType,
  listDeclaredResources,
  normalizeDeclaredResource,
  normalizeDeclaredResources,
  requiredUnitsFor,
  slugifyResourceId,
};
