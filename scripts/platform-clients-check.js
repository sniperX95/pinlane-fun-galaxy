// Gate du provisioning CLIENT (cote proprietaire Pinlane). Prouve en
// COMPORTEMENT : validation des slugs, insertion client, upsert centre rattache,
// creation des roles par defaut avec des codes UNIQUES retournes, et assemblage
// de la vue proprietaire. Les dependances lourdes (createRole, upsertCenter,
// getPool) sont remplacees par des espions via require.cache : on verifie que
// provisionClient ORCHESTRE correctement, pas Postgres.
'use strict';
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const resolve = (p) => require.resolve(path.join(ROOT, p));

// --- Espions injectes avant le require de platform-clients ------------------
const calls = { upsertCenter: [], createRole: [], clientInserts: [], centerUpdates: [] };

function stub(relPath, exportsObj) {
  const id = resolve(relPath);
  const m = new Module(id);
  m.filename = id;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[id] = m;
}

stub('lib/center-config.js', {
  upsertCenter: async (pool, center) => { calls.upsertCenter.push(center); return { id: center.id, name: center.name, status: center.status }; },
});
stub('lib/staff-auth.js', {
  ALL_PERMISSIONS: ['dashboard.view', 'direction.view', 'reservations.view', 'users.manage', 'settings.manage'],
  createRole: async ({ centerId, name, permissions }) => {
    calls.createRole.push({ centerId, name, permissions });
    // Code UNIQUE par appel (comme crypto.randomBytes) : prefixe = 2 lettres.
    const suffix = String(calls.createRole.length).padStart(4, '0');
    return { role: { id: name.toLowerCase(), name }, accessCode: `${name.slice(0, 2).toUpperCase()}-${suffix}-${suffix}` };
  },
});
stub('lib/database.js', {
  getPool: () => fakePoolForList,
});

// Faux pool pour provisionClient : enregistre les insert/update, repond aux select.
function makeProvisionPool() {
  return {
    async query(sql, params) {
      const s = String(sql);
      if (/insert into clients/i.test(s)) { calls.clientInserts.push(params); return { rowCount: 1, rows: [] }; }
      if (/update centers set client_id/i.test(s)) { calls.centerUpdates.push(params); return { rowCount: 1, rows: [] }; }
      if (/select name from clients/i.test(s)) return { rowCount: 1, rows: [{ name: 'Client Existant' }] };
      if (/update clients set status/i.test(s)) return { rowCount: 1, rows: [{ id: params[0], status: params[1] }] };
      return { rowCount: 0, rows: [] };
    },
  };
}

// Faux pool pour buildPlatformClients (via getPool) : 2 clients, 3 centres, staff.
const fakePoolForList = {
  async query(sql) {
    const s = String(sql);
    if (/from clients/i.test(s)) return { rows: [
      { id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard', contact_email: '', contact_phone: '', notes: '', created_at: new Date('2026-01-01') },
      { id: 'bowling-du-lac', name: 'Bowling du Lac', status: 'trial', plan: 'standard', contact_email: 'a@b.be', contact_phone: '', notes: '', created_at: new Date('2026-07-20') },
    ] };
    if (/from centers/i.test(s)) return { rows: [
      { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', client_id: 'fungalaxy' },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', client_id: 'fungalaxy' },
      { id: 'lac-centre', name: 'Bowling du Lac Centre', status: 'planned', client_id: 'bowling-du-lac' },
    ] };
    if (/from staff_members/i.test(s)) return { rows: [{ center_id: 'libramont', n: 4 }, { center_id: 'gembloux', n: 2 }] };
    return { rows: [] };
  },
};

const { buildPlatformClients, provisionClient, updateClientStatus } = require(resolve('lib/platform-clients.js'));

const checks = [];
let passed = 0;
function ok(name, cond, detail) { checks.push({ name, ok: !!cond }); console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`); if (cond) passed += 1; }

(async () => {
  console.log('\n[A] Validation : slugs et noms rejetes');
  let threw = false;
  try { await provisionClient(makeProvisionPool(), { id: 'MAJUSCULE_INVALIDE', name: 'X' }); } catch (e) { threw = e.expose === true; }
  ok('id client invalide rejete (expose)', threw);
  threw = false;
  try { await provisionClient(makeProvisionPool(), { id: 'bon-slug', name: '' }); } catch (e) { threw = e.expose === true; }
  ok('nom client vide rejete', threw);

  console.log('\n[B] Provisioning cle en main : client + centre + roles + codes');
  const before = calls.createRole.length;
  const out = await provisionClient(makeProvisionPool(), { id: 'bowling-du-lac', name: 'Bowling du Lac', center: { id: 'lac-centre', name: 'Bowling du Lac Centre' } });
  ok('client insere', calls.clientInserts.length >= 1);
  ok('centre upserte et rattache', calls.upsertCenter.some((c) => c.id === 'lac-centre') && calls.centerUpdates.some((p) => p[0] === 'lac-centre' && p[1] === 'bowling-du-lac'));
  ok('2 roles crees (Direction + Staff)', calls.createRole.length - before === 2, `${calls.createRole.length - before}`);
  ok('roles crees SUR LE BON centre', calls.createRole.slice(before).every((r) => r.centerId === 'lac-centre'));
  ok('codes d acces retournes (uniques, non nuls)', out.accessCodes.length === 2 && out.accessCodes.every((a) => a.code) && out.accessCodes[0].code !== out.accessCodes[1].code, JSON.stringify(out.accessCodes.map((a) => a.role)));
  ok('un role Direction est present', out.accessCodes.some((a) => a.role === 'Direction'));

  console.log('\n[C] Client sans centre : provisionne le client seul, aucun code');
  const beforeRoles = calls.createRole.length;
  const soloOut = await provisionClient(makeProvisionPool(), { id: 'client-solo', name: 'Client Solo' });
  ok('aucun role cree sans centre', calls.createRole.length === beforeRoles);
  ok('aucun code sans centre', soloOut.accessCodes.length === 0);

  console.log('\n[D] updateClientStatus : borne le statut');
  let statusThrew = false;
  try { await updateClientStatus(makeProvisionPool(), { id: 'fungalaxy', status: 'nimportequoi' }); } catch (e) { statusThrew = e.expose === true; }
  ok('statut invalide rejete', statusThrew);
  const st = await updateClientStatus(makeProvisionPool(), { id: 'fungalaxy', status: 'suspended' });
  ok('statut valide applique', st.status === 'suspended');

  console.log('\n[E] Vue proprietaire : clients avec leurs centres et effectifs');
  const view = await buildPlatformClients();
  ok('2 clients listes', view.clients.length === 2, `${view.clients.length}`);
  const fg = view.clients.find((c) => c.id === 'fungalaxy');
  ok('Fun Galaxy a 2 centres', fg && fg.centerCount === 2, fg && String(fg.centerCount));
  ok('effectif Fun Galaxy = 6 (4+2)', fg && fg.staffCount === 6, fg && String(fg.staffCount));
  ok('testData present (SaaS non lance)', view.testData === true);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nplatform-clients-check: ${passed}/${checks.length} verts.`);
  if (failed.length) { console.error(`platform-clients-check: ECHEC (${failed.length} rouge(s)).`); process.exit(1); }
  console.log('platform-clients-check: ALL OK (provisioning cle en main : client + centre + roles + codes uniques ; vue proprietaire correcte)');
  process.exit(0);
})().catch((e) => { console.error('platform-clients-check: exception', e && e.stack || e); process.exit(1); });
