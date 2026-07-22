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

const { getPool } = require('./database');
const { upsertCenter } = require('./center-config');
const { createRole, ALL_PERMISSIONS } = require('./staff-auth');
const { simulationSqlExclusion } = require('./simulation-filter');

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

// Provisionne un client CLE EN MAIN : le client, un centre initial optionnel, et
// ses roles + codes d'acces uniques. Idempotent (re-provisionner ne duplique ni
// n'ecrase les codes existants). Retourne les codes UNE fois, a remettre au
// client.
async function provisionClient(pool, input = {}) {
  const id = String(input.id || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  if (!CLIENT_ID_RX.test(id)) throw expose('Identifiant client invalide (slug kebab-case, 2 a 40 caracteres).');
  if (!name || name.length > 120) throw expose('Nom du client requis (120 caracteres maximum).');
  const status = STATUS_VALUES.has(input.status) ? input.status : 'active';
  const plan = String(input.plan || 'standard').trim().slice(0, 40) || 'standard';
  const contactEmail = String(input.contactEmail || '').trim().slice(0, 160);
  const contactPhone = String(input.contactPhone || '').trim().slice(0, 40);

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
    await upsertCenter(pool, { id: centerId, name: centerName, status: 'planned', timezone });
    await pool.query('update centers set client_id = $2, updated_at = now() where id = $1;', [centerId, id]);
    out.center = { id: centerId, name: centerName };
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

module.exports = { buildPlatformClients, provisionClient, updateClientStatus, addCenterToClient, setClientBilling };
