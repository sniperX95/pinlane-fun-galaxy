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

// Vue proprietaire : chaque client avec ses centres, ses effectifs et son statut.
async function buildPlatformClients() {
  const pool = getPool();
  const [clients, centers, staff] = await Promise.all([
    pool.query('select id, name, status, plan, contact_email, contact_phone, notes, created_at from clients order by created_at asc, id asc;'),
    pool.query("select id, name, status, coalesce(client_id, '') as client_id from centers order by client_id asc, id asc;"),
    pool.query("select center_id, count(*)::int as n from staff_members group by center_id;"),
  ]);
  const staffByCenter = new Map(staff.rows.map((r) => [r.center_id, Number(r.n) || 0]));
  const centersByClient = new Map();
  for (const c of centers.rows) {
    const key = c.client_id || '';
    if (!centersByClient.has(key)) centersByClient.set(key, []);
    centersByClient.get(key).push({ id: c.id, name: c.name, status: c.status, staff: staffByCenter.get(c.id) || 0 });
  }
  const list = clients.rows.map((row) => {
    const cc = centersByClient.get(row.id) || [];
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      plan: row.plan,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      notes: row.notes,
      createdAt: toIso(row.created_at),
      centers: cc,
      centerCount: cc.length,
      staffCount: cc.reduce((sum, x) => sum + (x.staff || 0), 0),
    };
  });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    testData: true,
    clients: list,
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

module.exports = { buildPlatformClients, provisionClient, updateClientStatus, addCenterToClient };
