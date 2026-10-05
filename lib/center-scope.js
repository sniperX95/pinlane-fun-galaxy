// Scoping tenant des CENTRES visibles par une session staff (2026-07-22).
//
// Probleme resolu : un client (ex. Fun Galaxy, qui possede libramont/gembloux/
// ciney) ne doit voir QUE ses propres centres, jamais ceux d'un autre client
// (ex. le centre MI-12 provisionne pour un autre client). Seul le PROPRIETAIRE
// de la plateforme (permission platform.admin) voit TOUS les centres, avec leur
// client pour les grouper.
//
// SOURCE DE VERITE = la base : table `centers` (colonne client_id, migration
// clients-schema) jointe a `clients` pour le nom. Le fichier baseline
// ops-knowledge/centers.json ne porte PAS client_id ; il ne sert qu'a enrichir
// la config (resources, horaires) via center-config. La LISTE et le FILTRE
// viennent TOUJOURS de la DB : des centres existent uniquement en base (MI-12,
// cree par provisioning) et doivent etre filtres correctement.
//
// Server-authoritative : le filtrage se fait ICI. Un client ne recoit JAMAIS
// dans la reponse un centre d'un autre client. Le front ne fait qu'afficher et
// grouper la liste deja scopee.

const { normalizeCenterConfig } = require('./center-config');
const { sessionHasPermission } = require('./staff-auth');
const CENTERS_BASELINE = require('../ops-knowledge/centers.json');

// Nom de repli par id (baseline fichier), pour le mode fail-soft uniquement.
const BASELINE_NAME_BY_ID = (() => {
  const map = {};
  try {
    (CENTERS_BASELINE.centers || []).forEach((center) => {
      if (center && center.id) map[center.id] = center.name || center.id;
    });
  } catch (error) {
    // baseline illisible : la map reste vide, le repli utilise l'id.
  }
  return map;
})();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Projette une ligne DB (centre + client joint) sur la forme consommee par le
// front : la config editable complete (comme listCenterConfigs) PLUS clientId /
// clientName pour le groupement cote proprietaire. La config est bornee par
// center-config (baseline fichier fusionne avec l'override DB).
function projectCenterRow(row) {
  const override = isPlainObject(row.settings && row.settings.config) ? row.settings.config : {};
  const config = normalizeCenterConfig(override, row.id);
  return {
    id: row.id,
    name: row.name,
    status: config.status || row.status,
    timezone: config.timezone || row.timezone,
    resources: config.resources,
    defaultSchedule: config.defaultSchedule == null ? null : config.defaultSchedule,
    activityAvailability: config.activityAvailability,
    // Les installations de chaque activite (tables, pistes de duckpin) : sans
    // elles ici, l ecran Etablissement ne pourrait ni les montrer ni les
    // remettre dans leurs champs apres enregistrement.
    activityCapacity: config.activityCapacity,
    activityOffers: config.activityOffers,
    upsellOffers: config.upsellOffers,
    // Le seuil de la demande sur mesure : l ecran Etablissement le montre et
    // le remet dans son champ apres enregistrement.
    customRequest: config.customRequest,
    holidaySettings: config.holidaySettings,
    offerAvailability: config.offerAvailability,
    classification: config.classification,
    accueil: config.accueil,
    // La validation par l equipe et la boite de secours (2026-10-05) : l ecran
    // Etablissement les montre et les remet dans leurs champs.
    validationEquipe: config.validationEquipe,
    secours: config.secours,
    customActivities: config.customActivities,
    // La MARQUE du centre (couleurs du tunnel). Elle manquait ici : l'ecran
    // Etablissement recevait tout SAUF la couleur, donc il ne pouvait ni la
    // montrer ni la remettre dans le champ apres enregistrement. null = pas de
    // marque, le tunnel garde l'accent plateforme.
    branding: config.branding || null,
    clientId: row.client_id || null,
    clientName: row.client_name || null,
  };
}

function normalizeSessionCenterId(session) {
  return String((session && session.centerId) || '').trim().toLowerCase();
}

// Repli fail-soft : ne JAMAIS fuiter. En cas d'echec DB, on ne renvoie que le
// centre de la session (depuis la baseline fichier), jamais la liste complete.
// C'est le choix le plus sur : mieux vaut une liste appauvrie qu'une fuite.
function fallbackForSession(session) {
  const id = normalizeSessionCenterId(session) || 'libramont';
  const config = normalizeCenterConfig({}, id);
  return [{
    id,
    name: BASELINE_NAME_BY_ID[id] || id,
    status: config.status,
    timezone: config.timezone,
    resources: config.resources,
    defaultSchedule: config.defaultSchedule == null ? null : config.defaultSchedule,
    activityAvailability: config.activityAvailability,
    activityCapacity: config.activityCapacity,
    activityOffers: config.activityOffers,
    upsellOffers: config.upsellOffers,
    // Le seuil de la demande sur mesure : l ecran Etablissement le montre et
    // le remet dans son champ apres enregistrement.
    customRequest: config.customRequest,
    holidaySettings: config.holidaySettings,
    offerAvailability: config.offerAvailability,
    classification: config.classification,
    accueil: config.accueil,
    // La validation par l equipe et la boite de secours (2026-10-05) : l ecran
    // Etablissement les montre et les remet dans leurs champs.
    validationEquipe: config.validationEquipe,
    secours: config.secours,
    customActivities: config.customActivities,
    branding: config.branding || null,
    clientId: null,
    clientName: null,
  }];
}

// Les centres VISIBLES par la session.
//   - Resout le client de la session : session.centerId -> centers.client_id.
//   - platform.admin -> TOUS les centres (avec clientId + clientName).
//   - Sinon -> uniquement les centres du MEME client. Un centre orphelin
//     (client_id null) n'est visible que du proprietaire : un client dont le
//     propre centre est orphelin ne voit QUE son centre, jamais un autre.
// Retourne toujours un tableau (fail-soft raisonnable, jamais de fuite).
async function listCentersForSession(pool, session) {
  const sessionCenterId = normalizeSessionCenterId(session);
  const isOwner = sessionHasPermission(session, 'platform.admin');

  let rows;
  try {
    const result = await pool.query(`
      select
        c.id,
        c.name,
        c.status,
        c.timezone,
        c.settings,
        nullif(c.client_id, '') as client_id,
        cl.name as client_name
      from centers c
      left join clients cl on cl.id = c.client_id
      order by cl.name asc nulls last, c.id asc;
    `);
    rows = Array.isArray(result.rows) ? result.rows : [];
  } catch (error) {
    return fallbackForSession(session);
  }

  // Le client de la session vient de SON propre centre en base.
  const ownRow = rows.find((row) => row.id === sessionCenterId);
  const sessionClientId = ownRow && ownRow.client_id ? String(ownRow.client_id) : null;

  let visible;
  if (isOwner) {
    // Proprietaire plateforme : tout, groupable par client.
    visible = rows;
  } else if (sessionClientId) {
    // Client identifie : uniquement les centres de SON client.
    visible = rows.filter((row) => String(row.client_id || '') === sessionClientId);
  } else {
    // Session dont le centre est orphelin (client_id null) : elle ne voit que
    // son propre centre, jamais un autre orphelin, jamais un autre client.
    visible = rows.filter((row) => row.id === sessionCenterId);
  }

  return visible.map(projectCenterRow);
}

module.exports = { listCentersForSession, projectCenterRow };
