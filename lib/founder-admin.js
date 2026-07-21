// ============================================================================
// PANNEAU DE CONTROLE FONDATEUR : les LECTEURS cross-centres (categorie
// Plateforme, permission platform.admin). Le pendant en ecriture reutilise les
// actions existantes (saveCenter / saveCenterConfig / setCenterStatus cote
// centres ; createMember / updateMemberRole / updateRolePermissions /
// toggleMemberStatus / createRole / regenerateRoleCode / revealMemberCode /
// revealRoleCode cote equipe), toutes tracees dans audit_log.
//
// Deux bundles, un fetch chacun :
//   buildFounderCenters : chaque centre de la table centers avec sa CONFIG
//     round-trippable (le patch exact que saveCenterConfig accepte), la
//     volumetrie (membres actifs, reservations 30 j, CA 30 j) et un
//     resourceModel qui decrit les champs editables pour que le front sache
//     quels controles rendre.
//   buildFounderTeam : roles, membres et catalogue de permissions cross-centres.
//     AUCUN hash, AUCUN code d'acces : le reveal est une action dediee a la
//     demande, jamais un vidage de liste. platform.admin est marque NON
//     assignable (escalade centre -> plateforme).
//
// Memes trois regles que lib/founder-cockpit.js : verite des donnees,
// resilience par section ({error} plutot que crash), aucun secret. testData:
// true tant que le SaaS n'est pas lance.

const { getPool } = require('./database');
const { normalizeCenterConfig } = require('./center-config');
const { simulationSqlExclusion } = require('./simulation-filter');
const { STAFF_PERMISSION_GROUPS, PLATFORM_PERMISSIONS } = require('./staff-auth');

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Charge une section sans jamais jeter : le panneau affiche l'echec de la
// brique, il ne s'ecroule pas avec elle (meme doctrine que founder-cockpit).
async function section(label, loader) {
  try {
    return await loader();
  } catch (error) {
    console.error(`[founder-admin] section ${label} indisponible`, error && (error.message || error));
    return { error: 'Cette lecture n\'a pas repondu. Rechargez dans un instant.' };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ── CONTRAT DE CHAMPS : ce que le front peut editer dans config.resources et
//    config.defaultSchedule. Ce sont des NOMS, des TYPES et des BORNES (les
//    memes que les normaliseurs de lib/center-config.js), pas des donnees. Le
//    front s'en sert pour rendre le bon controle (nombre borne, bascule, enum,
//    grille horaire) sans coder en dur la forme de la config.
const RESOURCE_MODEL = {
  statusValues: ['active', 'planned', 'closed'],
  resources: {
    bowling: {
      nullable: true,
      fields: {
        laneCount: { type: 'int', min: 1, max: 40 },
        normalCapacityPerLane: { type: 'int', min: 1, max: 12 },
        emergencyCapacityPerLane: { type: 'int', min: 1, max: 15, note: 'au moins normalCapacityPerLane' },
        forceExtraLaneAtPax: { type: 'int', min: 1, max: 20 },
        preferAdjacentLanes: { type: 'boolean' },
      },
    },
    laser: {
      nullable: true,
      fields: {
        weaponCount: { type: 'int', min: 0, max: 200 },
        parallelLaunches: { type: 'int', min: 1, max: 20 },
        canSplitGroupsCleanly: { type: 'boolean' },
        requiresCompleteGroupBeforeLaunch: { type: 'boolean' },
        riskLevel: { type: 'enum', values: ['critical', 'managed', 'low'] },
      },
    },
    partyTables: {
      nullable: true,
      fields: {
        softCapacity: { type: 'int', min: 1, max: 100 },
        hardCapacity: { type: 'int', min: 1, max: 120, note: 'au moins softCapacity' },
      },
    },
    barDesk: {
      nullable: true,
      fields: {
        handlesBooking: { type: 'boolean' },
        handlesBriefing: { type: 'boolean' },
        handlesFoodAndDrink: { type: 'boolean' },
        activityEscort: { type: 'boolean' },
      },
    },
  },
  defaultSchedule: {
    // Soit un marqueur texte NON editable (resolu ailleurs), soit une grille
    // jour par jour. Chaque bloc porte les jours 0 (dimanche) a 6 (samedi) ;
    // un jour vaut null (ferme) ou { open, close } au format HH:MM (00:00 a
    // 24:00). Absent de la config quand aucune grille n'est posee.
    kind: 'schedule',
    optional: true,
    blocks: ['regular', 'holiday'],
    days: ['0', '1', '2', '3', '4', '5', '6'],
    dayShape: {
      closed: null,
      open: {
        open: { type: 'time', pattern: 'HH:MM' },
        close: { type: 'time', pattern: 'HH:MM' },
      },
    },
    textMarkers: ['same_as_libramont_public_schedule', 'to_confirm'],
  },
};

// Config editable EXACTE d'une ligne centers : l'override persiste
// (settings.config) fusionne sur la baseline fichier et re-borne. C'est
// l'objet que le front renverra tel quel (ou par patch) a saveCenterConfig,
// et il est round-trippable (idempotent par normalizeCenterConfig).
function centerConfigForRow(row) {
  const override = row && isPlainObject(row.settings) && isPlainObject(row.settings.config)
    ? row.settings.config
    : {};
  return normalizeCenterConfig(override, row.id);
}

async function loadCenterVolumes(pool) {
  const [members, reservations] = await Promise.all([
    pool.query(`
      select center_id, count(*)::int as active
      from staff_members
      where status = 'active'
      group by center_id;
    `),
    // Lecteur ANALYTIQUE (comptes + CA) : la simulation est EXCLUE, comme le
    // veut lib/simulation-filter (sinon le CA affiche double). Les annulees et
    // les lignes hors des 30 derniers jours ne comptent pas.
    pool.query(`
      select center_id,
             count(*)::int as reservations,
             coalesce(sum(price), 0)::float as revenue
      from reservations
      where status <> 'cancelled'
        and date >= (now() - interval '30 days')::date
        and ${simulationSqlExclusion()}
      group by center_id;
    `),
  ]);
  const membersByCenter = new Map(members.rows.map((row) => [row.center_id, Number(row.active) || 0]));
  const reservationsByCenter = new Map(reservations.rows.map((row) => [row.center_id, {
    reservations: Number(row.reservations) || 0,
    revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
  }]));
  return { membersByCenter, reservationsByCenter };
}

async function buildFounderCenters() {
  const pool = getPool();

  const centersSection = await section('centers', async () => {
    const result = await pool.query('select id, name, status, timezone, settings from centers order by id asc;');
    return { rows: result.rows };
  });

  if (centersSection.error) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      testData: true,
      window30d: '30 derniers jours',
      resourceModel: RESOURCE_MODEL,
      centers: [],
      centersError: centersSection.error,
      volumesError: null,
    };
  }

  const volumes = await section('volumes', () => loadCenterVolumes(pool));
  const membersByCenter = volumes.error ? new Map() : volumes.membersByCenter;
  const reservationsByCenter = volumes.error ? new Map() : volumes.reservationsByCenter;

  const centers = centersSection.rows.map((row) => {
    const config = centerConfigForRow(row);
    const reservations = reservationsByCenter.get(row.id) || { reservations: 0, revenue: 0 };
    return {
      id: row.id,
      name: row.name,
      // Le statut affiche vient de la config editable (source de verite du
      // moteur), pas de la colonne brute : les deux convergent apres une
      // ecriture, la config prime en cas d'ecart transitoire.
      status: config.status || row.status,
      timezone: config.timezone || row.timezone,
      config,
      members: membersByCenter.get(row.id) || 0,
      reservations30d: reservations.reservations,
      revenue30d: reservations.revenue,
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    window30d: '30 derniers jours',
    resourceModel: RESOURCE_MODEL,
    centers,
    centersError: null,
    volumesError: volumes.error || null,
  };
}

// ── Catalogue des permissions assignables ───────────────────────────────────
//
// Derive de ALL_PERMISSIONS / STAFF_PERMISSION_GROUPS (source de verite dans
// lib/staff-auth.js) : le catalogue reste en phase avec les droits reels. Un
// libelle FR lisible et un groupe par permission pour que l'editeur de role du
// front rende des cases a cocher groupees. platform.admin est LISTE mais
// marque assignable:false : jamais propose a l'attribution (escalade centre ->
// plateforme, refusee cote serveur par stripPlatformPermissions et
// updateMemberRole).
const GROUP_LABELS = {
  pilotage: 'Pilotage',
  planning: 'Planning',
  reservations: 'Reservations',
  clients: 'Clients',
  communication: 'Mails',
  administration: 'Administration',
};

const PERMISSION_LABELS = {
  'dashboard.view': 'Voir le tableau de bord',
  'direction.view': 'Vue direction',
  'centers.switch': 'Basculer entre les centres',
  'reports.export': 'Exporter les rapports',
  'planning.view': 'Voir le planning',
  'planning.bowling': 'Planning bowling',
  'planning.laser': 'Planning laser',
  'planning.drag': 'Deplacer au planning',
  'planning.past': 'Voir le planning passe',
  'reservations.view': 'Voir les reservations',
  'reservations.create': 'Creer une reservation',
  'reservations.edit': 'Modifier une reservation',
  'reservations.cancel': 'Annuler une reservation',
  'reservations.status': 'Changer le statut d\'une reservation',
  'reservations.quick': 'Reservation rapide',
  'clients.view': 'Voir les clients',
  'clients.edit': 'Modifier les clients',
  'payments.view': 'Voir les paiements',
  'payments.markPaid': 'Marquer un paiement recu',
  'exports.download': 'Telecharger les exports',
  'emails.view': 'Voir les mails',
  'emails.send': 'Envoyer des mails',
  'campaigns.manage': 'Gerer les campagnes',
  'marketing.agents': 'Agents marketing',
  'pricing.manage': 'Gerer les tarifs',
  'users.manage': 'Gerer les utilisateurs et roles',
  'settings.manage': 'Gerer les parametres du centre',
  'security.codes': 'Codes de securite',
  'ai.ops': 'Operations IA',
  'platform.admin': 'Administration plateforme (fondateur)',
};

function labelFor(key) {
  return PERMISSION_LABELS[key] || key;
}

function buildPermissionsCatalog() {
  const catalog = [];
  for (const group of STAFF_PERMISSION_GROUPS) {
    const groupLabel = GROUP_LABELS[group.id] || group.id;
    for (const key of group.permissions) {
      catalog.push({ key, label: labelFor(key), group: groupLabel, assignable: true });
    }
  }
  // Permissions de niveau plateforme : listees pour la transparence, JAMAIS
  // assignables. Le front ne les propose pas ; le serveur les retirerait de
  // toute facon a l'ecriture.
  for (const key of PLATFORM_PERMISSIONS) {
    catalog.push({ key, label: labelFor(key), group: 'Plateforme', assignable: false });
  }
  return catalog;
}

function safePermissionList(permissions) {
  return Array.isArray(permissions) ? permissions.filter((item) => typeof item === 'string') : [];
}

async function buildFounderTeam() {
  const pool = getPool();

  const centersSection = await section('centers', async () => {
    const result = await pool.query('select id, name from centers order by id asc;');
    return { rows: result.rows.map((row) => ({ id: row.id, name: row.name })) };
  });

  const rolesSection = await section('roles', async () => {
    const result = await pool.query(`
      select center_id, id, name, permissions, locked
      from staff_roles
      order by center_id asc, locked desc, name asc;
    `);
    return { rows: result.rows };
  });

  const membersSection = await section('members', async () => {
    // access_code_enc lu UNIQUEMENT pour deriver le booleen hasCode. La valeur
    // n'est jamais renvoyee, et access_code_hash n'est meme pas selectionne :
    // aucun secret ne peut fuir par cette lecture.
    const result = await pool.query(`
      select id, center_id, name, role_id, status, access_code_enc
      from staff_members
      order by center_id asc, name asc;
    `);
    return { rows: result.rows };
  });

  const loginsSection = await section('logins', async () => {
    const result = await pool.query(`
      select actor_member_id, max(created_at) as last_login
      from staff_access_events
      where event_type = 'login_success' and actor_member_id is not null
      group by actor_member_id;
    `);
    return { byMember: new Map(result.rows.map((row) => [row.actor_member_id, row.last_login])) };
  });

  const centers = centersSection.error ? [] : centersSection.rows;
  const roleRows = rolesSection.error ? [] : rolesSection.rows;
  const memberRows = membersSection.error ? [] : membersSection.rows;
  const lastLoginByMember = loginsSection.error ? new Map() : loginsSection.byMember;

  const roleNameByKey = new Map(roleRows.map((row) => [`${row.center_id}|${row.id}`, row.name]));

  // Compte des membres par role (center|role) : la volumetrie de l'editeur
  // d'equipe. Mesure sur la liste reelle, pas une chaine.
  const memberCountByRole = new Map();
  for (const row of memberRows) {
    const key = `${row.center_id}|${row.role_id}`;
    memberCountByRole.set(key, (memberCountByRole.get(key) || 0) + 1);
  }

  const roles = roleRows.map((row) => ({
    id: row.id,
    name: row.name,
    centerId: row.center_id,
    locked: Boolean(row.locked),
    permissions: safePermissionList(row.permissions),
    memberCount: memberCountByRole.get(`${row.center_id}|${row.id}`) || 0,
  }));

  const members = memberRows.map((row) => ({
    id: row.id,
    name: row.name,
    centerId: row.center_id,
    roleId: row.role_id,
    roleName: roleNameByKey.get(`${row.center_id}|${row.role_id}`) || row.role_id,
    // Le SaaS ne connait que actif / desactive cote equipe : 'blocked' devient
    // 'disabled', tout le reste (actif, en attente de premiere connexion) est
    // 'active' (le code fonctionne, la personne peut entrer).
    status: row.status === 'blocked' ? 'disabled' : 'active',
    lastLoginAt: toIso(lastLoginByMember.get(row.id)),
    hasCode: Boolean(row.access_code_enc),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    permissionsCatalog: buildPermissionsCatalog(),
    centers,
    roles,
    members,
    centersError: centersSection.error || null,
    rolesError: rolesSection.error || null,
    membersError: membersSection.error || null,
  };
}

module.exports = {
  buildFounderCenters,
  buildFounderTeam,
  // Exportes pour le gate (comportement, jamais des chaines) et pour la
  // reutilisation eventuelle du contrat de champs cote front.
  RESOURCE_MODEL,
  buildPermissionsCatalog,
};
