// Gestion des CLIENTS Pinlane (cote PROPRIETAIRE), 2026-07-21.
//
// Distinction cle : la vue Direction / Etablissement est l'outil des CLIENTS
// (Fun Galaxy gere ses centres). Ici, c'est l'outil du PROPRIETAIRE de Pinlane :
// lister ses clients (entreprises), en ajouter, provisionner leurs centres et
// leurs acces CLE EN MAIN (roles Direction + Staff avec des codes UNIQUES,
// jamais ceux d'un autre client), suivre leur statut.
//
// Securite : les codes d'acces sont generes par createRole (lib/staff-auth), la
// meme primitive que le reste de l'app (crypto.randomBytes + hash + chiffrement).
// createRole retire platform.admin des permissions attribuees : un client ne
// peut JAMAIS devenir proprietaire de la plateforme.

const { getPool, saveEmailIdentity } = require('./database');
const { upsertCenter, saveCenterConfigOverride, normalizeBranding } = require('./center-config');
const { createRole, ALL_PERMISSIONS } = require('./staff-auth');
const { seedPlannableActivitiesForClient } = require('./catalog-store');
const { simulationSqlExclusion } = require('./simulation-filter');
// Baseline FICHIER des centres (meme require trace par le bundler Vercel que
// lib/center-config). Un centre present ici (libramont, gembloux, ciney) vit
// dans ops-knowledge/centers.json : supprimer sa ligne DB ne le supprimerait
// pas (le moteur et la migration 0008 le re-materialisent depuis le fichier).
// Il n'est donc PAS supprimable a l'execution, et on le dit honnetement.
const CENTERS_BASELINE = require('../ops-knowledge/centers.json');
const BASELINE_CENTER_IDS = new Set((CENTERS_BASELINE.centers || []).map((c) => String(c.id)));

// Ce qu un centre neuf declare tant que l ecran Etablissement n a rien change :
// normalizeCenterConfig pose une piste de bowling et une table, jamais d arene
// laser (weaponCount 0). Miroir volontaire de lib/center-config.
const DEFAULT_PLANNABLE_RESOURCES = { bowling: { laneCount: 8 }, laser: { weaponCount: 0 }, partyTables: { softCapacity: 6 } };

const CLIENT_ID_RX = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CENTER_ID_RX = /^[a-z0-9][a-z0-9-]{1,39}$/;
const STATUS_VALUES = new Set(['active', 'trial', 'suspended', 'churned']);

// Roles provisionnes a la creation d'un centre client : la Direction (tous les
// droits DU CENTRE, jamais plateforme) et un Staff operationnel de base.
const PROVISION_ROLES = [
  { name: 'Direction', permissions: ALL_PERMISSIONS },
  { name: 'Staff', permissions: ['dashboard.view', 'planning.view', 'reservations.view', 'reservations.create', 'reservations.edit', 'reservations.status', 'clients.view'] },
];

function expose(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// numeric pg -> nombre JS, en preservant NULL. Un prix non pose vaut null
// (a definir), JAMAIS 0 : c'est la difference entre "gratuit" et "pas encore
// facture", et le MRR ne doit pas confondre les deux.
function toPrice(value) {
  return value === null || value === undefined ? null : Number(value);
}

// CA reel par centre sur 30 j. MEMES exclusions que
// founder-admin.loadCenterVolumes, via la SOURCE UNIQUE du predicat de
// simulation (lib/simulation-filter) : annulees hors compte, fenetre 30 j,
// lignes de simulation exclues (sinon le CA affiche double, cf. releve prod du
// 2026-07-19). Lecteur ANALYTIQUE : l'exclusion est obligatoire ici.
async function loadCenterRevenue30d(pool) {
  const result = await pool.query(`
    select center_id, coalesce(sum(price), 0)::float as revenue
    from reservations
    where status <> 'cancelled'
      and date >= (now() - interval '30 days')::date
      and ${simulationSqlExclusion()}
    group by center_id;
  `);
  const byCenter = new Map();
  result.rows.forEach((row) => {
    byCenter.set(row.center_id, round2(row.revenue));
  });
  return byCenter;
}

// Vue proprietaire : chaque client avec ses centres, ses effectifs, son prix
// mensuel et son CA reel 30 j, plus un agregat plateforme (MRR, clients/centres
// actifs, CA total). Honnetete : un prix null n'est jamais transforme en 0
// affiche ; il compte comme 0 dans la SOMME du MRR mais clientsWithPrice dit
// combien de prix sont reellement poses, pour que le front sache distinguer
// "MRR mesure" de "prix a definir".
async function buildPlatformClients() {
  const pool = getPool();
  const [clients, centers, staff, revenueByCenter] = await Promise.all([
    pool.query('select id, name, status, plan, monthly_price, contact_email, contact_phone, notes, created_at from clients order by created_at asc, id asc;'),
    pool.query("select id, name, status, coalesce(client_id, '') as client_id from centers order by client_id asc, id asc;"),
    pool.query("select center_id, count(*)::int as n from staff_members group by center_id;"),
    loadCenterRevenue30d(pool),
  ]);
  const staffByCenter = new Map(staff.rows.map((r) => [r.center_id, Number(r.n) || 0]));
  const centersByClient = new Map();
  for (const c of centers.rows) {
    const key = c.client_id || '';
    if (!centersByClient.has(key)) centersByClient.set(key, []);
    centersByClient.get(key).push({
      id: c.id,
      name: c.name,
      status: c.status,
      staff: staffByCenter.get(c.id) || 0,
      revenue30d: revenueByCenter.get(c.id) || 0,
    });
  }
  const list = clients.rows.map((row) => {
    const cc = centersByClient.get(row.id) || [];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      plan: row.plan,
      // Ce que le client paie a Pinlane par mois (null = a definir).
      monthlyPrice: toPrice(row.monthly_price),
      // CA reel de SES centres sur 30 j (reservations reelles, hors simulation
      // et annulees) : ce que le client fait tourner, distinct de ce qu'il paie.
      revenue30d: round2(cc.reduce((sum, x) => sum + (x.revenue30d || 0), 0)),
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      notes: row.notes,
      createdAt: toIso(row.created_at),
      centers: cc,
      centerCount: cc.length,
      staffCount: cc.reduce((sum, x) => sum + (x.staff || 0), 0),
    };
  });

  // Agregat plateforme. MRR = somme des prix des clients au statut 'active'
  // UNIQUEMENT (un client suspendu/trial/churned ne paie pas encore un
  // abonnement recurrent) ; un prix null compte comme 0. activeCenters = centres
  // au statut brut 'active'. revenue30dAll = CA reel de TOUS les centres.
  const mrr = round2(list.reduce(
    (sum, c) => sum + (c.status === 'active' && c.monthlyPrice ? c.monthlyPrice : 0),
    0,
  ));
  let revenue30dAll = 0;
  for (const value of revenueByCenter.values()) revenue30dAll += value || 0;
  const platform = {
    mrr,
    activeClients: list.filter((c) => c.status === 'active').length,
    activeCenters: centers.rows.filter((c) => c.status === 'active').length,
    revenue30dAll: round2(revenue30dAll),
    // Honnetete du MRR : combien de clients ont REELLEMENT un prix pose. Si 0,
    // le MRR vaut 0 non pas parce que personne ne paie, mais parce que rien
    // n'est renseigne : le front affiche "a definir" plutot qu'un faux 0 EUR.
    clientsWithPrice: list.filter((c) => c.monthlyPrice !== null).length,
    clientCount: list.length,
    centerCount: centers.rows.length,
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    clients: list,
    platform,
    orphanCenters: centersByClient.get('') || [],
  };
}

async function updateClientStatus(pool, { id, status } = {}) {
  const clientId = String(id || '').trim().toLowerCase();
  if (!CLIENT_ID_RX.test(clientId)) throw expose('Identifiant client invalide.');
  if (!STATUS_VALUES.has(status)) throw expose('Statut client invalide (active, trial, suspended, churned).');
  const result = await pool.query('update clients set status = $2, updated_at = now() where id = $1 returning id, status;', [clientId, status]);
  if (!result.rowCount) throw expose('Client introuvable.');
  return result.rows[0];
}

const SENDER_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// MARQUE ET EXPEDITEUR DU CENTRE, poses AU PROVISIONNEMENT.
//
// Ces deux reglages existaient deja cote API (saveCenterConfig pour les
// couleurs, saveEmailIdentity pour l'identite d'envoi), mais AUCUN ecran ne les
// proposait au moment ou un client est cree : accueillir un client demandait
// deux appels a la main depuis un terminal. Ils voyagent desormais dans
// `center.branding` et `center.sender`, poses par le formulaire "Nouveau
// client" de la console.
//
// Les deux sont FACULTATIFS et leur absence est un etat honnete, pas un trou :
// sans branding le tunnel garde l'accent plateforme, sans identite les emails
// partent de l'adresse plateforme (repli assume de sendEmail).
function readCenterBrand(center = {}) {
  const brand = { branding: null, sender: null };
  if (center.branding !== undefined && center.branding !== null) {
    const branding = normalizeBranding(center.branding);
    if (!branding) {
      throw expose('Couleurs du centre invalides (codes hexadecimaux #rrggbb attendus).');
    }
    brand.branding = branding;
  }
  const sender = center.sender;
  if (sender && (sender.email || sender.label)) {
    const email = String(sender.email || '').trim().toLowerCase();
    if (!SENDER_EMAIL_RX.test(email)) {
      throw expose('Adresse d\'expediteur invalide (adresse email complete attendue).');
    }
    const label = String(sender.label || '').trim().slice(0, 120);
    brand.sender = { email, label: label || String(center.name || email).trim().slice(0, 120) };
  }
  return brand;
}

// Ecrit l'identite d'expediteur SANS jamais la dupliquer : re-provisionner le
// meme centre avec la meme adresse met a jour la ligne existante au lieu d'en
// empiler une deuxieme (provisionClient est idempotent, cette etape aussi).
async function applyCenterSender(pool, centerId, sender) {
  const existing = await pool.query(
    'select id from email_identities where center_id = $1 and lower(email) = $2 limit 1;',
    [centerId, sender.email],
  );
  const id = existing.rowCount ? existing.rows[0].id : null;
  // Le provisionnement EST la plateforme : il peut ouvrir un domaine neuf pour
  // ce client, jamais prendre celui d un autre (lib/sender-domains.js).
  return saveEmailIdentity({ id, centerId, label: sender.label, email: sender.email, isDefault: true, declarationPlateforme: true });
}

// Provisionne un client CLE EN MAIN : le client, un centre initial optionnel,
// ses couleurs, son identite d'expediteur, et ses roles + codes d'acces
// uniques. Idempotent (re-provisionner ne duplique ni n'ecrase les codes
// existants). Retourne les codes UNE fois, a remettre au client.
async function provisionClient(pool, input = {}) {
  const id = String(input.id || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  if (!CLIENT_ID_RX.test(id)) throw expose('Identifiant client invalide (slug kebab-case, 2 a 40 caracteres).');
  if (!name || name.length > 120) throw expose('Nom du client requis (120 caracteres maximum).');
  const status = STATUS_VALUES.has(input.status) ? input.status : 'active';
  const plan = String(input.plan || 'standard').trim().slice(0, 40) || 'standard';
  const contactEmail = String(input.contactEmail || '').trim().slice(0, 160);
  const contactPhone = String(input.contactPhone || '').trim().slice(0, 40);
  // Saisies de marque validees AVANT la moindre ecriture : un refus ne doit
  // jamais laisser derriere lui un client a moitie cree.
  const brand = readCenterBrand(input.center || {});

  await pool.query(
    `insert into clients (id, name, status, plan, contact_email, contact_phone)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       name = excluded.name, status = excluded.status, plan = excluded.plan,
       contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
       updated_at = now();`,
    [id, name, status, plan, contactEmail, contactPhone],
  );

  const out = { client: { id, name, status, plan }, center: null, accessCodes: [] };

  const center = input.center;
  if (center && center.id) {
    const centerId = String(center.id).trim().toLowerCase();
    if (!CENTER_ID_RX.test(centerId)) throw expose('Identifiant centre invalide (slug kebab-case).');
    const centerName = (String(center.name || name).trim().slice(0, 120)) || name;
    const timezone = String(center.timezone || 'Europe/Brussels').trim() || 'Europe/Brussels';
    // Le centre demarre 'planned' : le client le passe 'active' quand il est pret.
    const upserted = await upsertCenter(pool, { id: centerId, name: centerName, status: 'planned', timezone });
    await pool.query('update centers set client_id = $2, updated_at = now() where id = $1;', [centerId, id]);
    out.center = { id: centerId, name: centerName, branding: null, sender: null };
    // Les couleurs vivent dans la MEME config que le reste du centre
    // (centers.settings.config), donc par le meme chemin d'ecriture que
    // l'ecran Etablissement. On repasse le statut qu'on vient de poser :
    // saveCenterConfigOverride reecrit la colonne `status` a partir de la
    // config fusionnee, et un centre neuf y vaudrait 'active' par defaut.
    if (brand.branding) {
      const config = await saveCenterConfigOverride(pool, centerId, {
        branding: brand.branding,
        status: String((upserted && upserted.status) || 'planned'),
      });
      out.center.branding = config.branding || null;
    }
    if (brand.sender) {
      const identity = await applyCenterSender(pool, centerId, brand.sender);
      out.center.sender = { label: identity.label || brand.sender.label, email: identity.email || brand.sender.email };
    }
    // SON catalogue de depart : les ressources que le moteur planifie et que ce
    // centre declare (une piste, une arene, une table), copiees DANS SA portee.
    // Le socle du premier client ne se prete plus : sans ces lignes, le gerant
    // ne pourrait meme pas creer une formule « 1 partie de bowling ». Tout le
    // reste de son catalogue, c est lui qui le cree.
    try {
      const seeded = await seedPlannableActivitiesForClient(pool, {
        ownerClientId: id,
        resources: (upserted && upserted.settings && upserted.settings.config && upserted.settings.config.resources) || DEFAULT_PLANNABLE_RESOURCES,
      });
      out.center.activities = seeded;
    } catch (error) {
      // Un catalogue de depart absent se rattrape dans l ecran Activites : ce
      // n est pas une raison de refuser la creation du client.
      out.center.activities = [];
    }
    // Roles + codes uniques via createRole (codes generes/hashes/chiffres comme
    // partout ailleurs ; platform.admin est retire par createRole).
    for (const preset of PROVISION_ROLES) {
      try {
        const created = await createRole({ centerId, name: preset.name, permissions: preset.permissions });
        out.accessCodes.push({ centerId, role: preset.name, code: created.accessCode });
      } catch (error) {
        // Role deja present (re-provisioning) : on ne regenere pas son code.
        out.accessCodes.push({ centerId, role: preset.name, code: null, note: 'role deja present' });
      }
    }
  }
  return out;
}

async function addCenterToClient(pool, { clientId, center } = {}) {
  const id = String(clientId || '').trim().toLowerCase();
  if (!CLIENT_ID_RX.test(id)) throw expose('Identifiant client invalide.');
  const row = await pool.query('select name from clients where id = $1 limit 1;', [id]);
  if (!row.rowCount) throw expose('Client introuvable.');
  return provisionClient(pool, { id, name: row.rows[0].name, center });
}

// Fixe (ou efface) le prix mensuel que le client paie a Pinlane. monthlyPrice
// null / '' efface le prix (retour a "a definir") ; sinon borne 0..100000 EUR.
// Trace comme updateClientStatus (dispatcher POST, gate platform.admin).
async function setClientBilling(pool, { clientId, id, monthlyPrice } = {}) {
  const cid = String(clientId || id || '').trim().toLowerCase();
  if (!CLIENT_ID_RX.test(cid)) throw expose('Identifiant client invalide.');
  let price = null;
  if (monthlyPrice !== null && monthlyPrice !== undefined && String(monthlyPrice).trim() !== '') {
    const value = Number(monthlyPrice);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      throw expose('Prix mensuel invalide (0 a 100000 EUR, ou vide pour effacer).');
    }
    price = Math.round(value * 100) / 100;
  }
  const result = await pool.query(
    'update clients set monthly_price = $2, updated_at = now() where id = $1 returning id, monthly_price;',
    [cid, price],
  );
  if (!result.rowCount) throw expose('Client introuvable.');
  return { id: result.rows[0].id, monthlyPrice: toPrice(result.rows[0].monthly_price) };
}

// ── SUPPRESSION (nettoyage des donnees de test avant lancement) ─────────────
//
// Politique d'integrite, choisie pour ne JAMAIS corrompre en silence :
//  - un centre BASELINE (fichier centers.json) est refuse : sa ligne DB n'est
//    qu'une projection, la supprimer laisserait le fichier le recreer ;
//  - un centre qui porte des RESERVATIONS est refuse (meme annulees ou de
//    simulation) : les donnees metier ne s'effacent pas en silence ;
//  - un client qui possede encore des CENTRES est refuse (BLOQUE, pas de
//    cascade) : le proprietaire retire ses centres un a un, chacun avec sa
//    propre confirmation, puis supprime le client. Consequence assumee : le
//    client seed 'fungalaxy' est de fait insupprimable tant qu'il porte les
//    centres baseline.
//
// Tables qui referencent centers(id) par cle etrangere : migration 0008
// (tenant-integrity, NOT VALID mais active) + FKs en dur des migrations 0012
// (direction_reports), 0013 (email_templates, email_identities), 0015
// (campaigns) et 0030 (marketing_suppressions). Une ligne restante y BLOQUE le
// DELETE du centre : on les vide dans la MEME transaction. Ce sont des lignes
// techniques (acces, files, journaux d'exploitation) : les reservations, elles,
// ne figurent pas ici, leur presence REFUSE la suppression en amont.
// Ordre impose par les FKs internes : staff_sessions et staff_members avant
// staff_roles (members -> roles est ON DELETE RESTRICT).
const CENTER_DEPENDENT_TABLES = [
  'staff_sessions',
  'staff_members',
  'staff_roles',
  'staff_access_events',
  'lane_statuses',
  'ops_events',
  'ops_agent_suggestions',
  'communications',
  'ops_simulation_runs',
  'ops_decision_logs',
  'ops_jobs',
  'ops_delay_incidents',
  'direction_reports',
  'campaigns',
  'email_templates',
  'email_identities',
  'marketing_suppressions',
];

async function deleteCenter(pool, { id } = {}) {
  const centerId = String(id || '').trim().toLowerCase();
  if (!CENTER_ID_RX.test(centerId)) throw expose('Identifiant centre invalide.');
  if (BASELINE_CENTER_IDS.has(centerId)) {
    throw expose('Centre de base defini dans le fichier (ops-knowledge/centers.json) : non supprimable ici.');
  }
  const row = await pool.query('select id, name from centers where id = $1 limit 1;', [centerId]);
  if (!row.rowCount) throw expose('Centre introuvable.');
  // sim-unfiltered: garde-fou d'INTEGRITE avant une suppression destructive
  // (purge de 17 tables liees). Les lignes de simulation vivent dans la vraie
  // table : les exclure de ce compte ferait passer pour vide un centre qui
  // porte encore des donnees, et la suppression les emporterait en silence -
  // exactement ce que le message d'erreur ci-dessous promet de ne jamais faire.
  const reservations = await pool.query('select count(*)::int as n from reservations where center_id = $1;', [centerId]);
  const reservationCount = Number(reservations.rows[0] && reservations.rows[0].n) || 0;
  if (reservationCount > 0) {
    throw expose(`Ce centre porte ${reservationCount} reservation(s) : retirez d'abord ses reservations. Elles ne se suppriment jamais en silence.`);
  }
  const client = await pool.connect();
  const removed = {};
  try {
    await client.query('BEGIN');
    for (const table of CENTER_DEPENDENT_TABLES) {
      // Noms de table STATIQUES (liste fermee ci-dessus), jamais une entree
      // utilisateur : pas d'injection possible. Le centre voyage en parametre.
      const result = await client.query(`delete from ${table} where center_id = $1;`, [centerId]);
      if (result.rowCount) removed[table] = result.rowCount;
    }
    const deleted = await client.query('delete from centers where id = $1;', [centerId]);
    if (!deleted.rowCount) throw expose('Centre introuvable.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { id: centerId, name: row.rows[0].name, removed };
}

async function deleteClient(pool, { id } = {}) {
  const clientId = String(id || '').trim().toLowerCase();
  if (!CLIENT_ID_RX.test(clientId)) throw expose('Identifiant client invalide.');
  const row = await pool.query('select id, name from clients where id = $1 limit 1;', [clientId]);
  if (!row.rowCount) throw expose('Client introuvable.');
  const centers = await pool.query('select count(*)::int as n from centers where client_id = $1;', [clientId]);
  const centerCount = Number(centers.rows[0] && centers.rows[0].n) || 0;
  if (centerCount > 0) {
    throw expose(`Ce client possede encore ${centerCount} centre(s). Retirez d'abord chacun de ses centres, puis supprimez le client.`);
  }
  const deleted = await pool.query('delete from clients where id = $1;', [clientId]);
  if (!deleted.rowCount) throw expose('Client introuvable.');
  return { id: clientId, name: row.rows[0].name };
}

module.exports = { buildPlatformClients, provisionClient, updateClientStatus, addCenterToClient, setClientBilling, deleteCenter, deleteClient };
