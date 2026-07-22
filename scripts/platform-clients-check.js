// Gate du provisioning CLIENT (cote proprietaire Pinlane). Prouve en
// COMPORTEMENT : validation des slugs, insertion client, upsert centre rattache,
// creation des roles par defaut avec des codes UNIQUES retournes, et assemblage
// de la vue proprietaire. Les dependances lourdes (createRole, upsertCenter,
// getPool) sont remplacees par des espions via require.cache : on verifie que
// provisionClient ORCHESTRE correctement, pas Postgres.
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const resolve = (p) => require.resolve(path.join(ROOT, p));

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

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
      if (/update clients set monthly_price/i.test(s)) return { rowCount: 1, rows: [{ id: params[0], monthly_price: params[1] }] };
      return { rowCount: 0, rows: [] };
    },
  };
}

// Reservations pour le CA reel 30 j (loadCenterRevenue30d). libramont attendu :
// 150 EUR (100 + 50). Les pieges qui ne doivent JAMAIS compter : une annulee
// (999), une hors fenetre a 45 j (777) et une de SIMULATION (channel sim-staff,
// 200). gembloux : 30 EUR. lac-centre : aucune (client suspendu, centre planifie).
const RES_ROWS = [
  { center_id: 'libramont', status: 'confirmed', at: NOW - 2 * DAY, price: 100, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 10 * DAY, price: 50, channel: '' },
  { center_id: 'libramont', status: 'cancelled', at: NOW - 3 * DAY, price: 999, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 45 * DAY, price: 777, channel: '' },
  { center_id: 'libramont', status: 'confirmed', at: NOW - 1 * DAY, price: 200, channel: 'sim-staff' },
  { center_id: 'gembloux', status: 'confirmed', at: NOW - 4 * DAY, price: 30, channel: '' },
];

// Evaluateur qui OBEIT au texte SQL : un filtre retire du code (annulees,
// fenetre 30 j, exclusion simulation) retire son effet ici, et l'assertion vire
// au rouge (meme motif que founder-admin-check).
function reservationRevenueRows(sql) {
  let rows = RES_ROWS.slice();
  if (/status <> 'cancelled'/.test(sql)) rows = rows.filter((r) => r.status !== 'cancelled');
  if (/interval '30 days'/.test(sql)) rows = rows.filter((r) => r.at > NOW - 30 * DAY);
  if (/not in \('sim-client', 'sim-staff'\)/.test(sql)) {
    rows = rows.filter((r) => r.channel !== 'sim-client' && r.channel !== 'sim-staff');
  }
  const map = new Map();
  rows.forEach((r) => { map.set(r.center_id, (map.get(r.center_id) || 0) + r.price); });
  return [...map.entries()].map(([center_id, revenue]) => ({ center_id, revenue }));
}

// Faux pool pour buildPlatformClients (via getPool) : 3 clients, 3 centres,
// staff, reservations. fungalaxy (actif, 490 EUR/mois) porte libramont+gembloux ;
// bowling-du-lac (SUSPENDU, 200 EUR/mois) porte lac-centre planifie ; solo-null
// (ACTIF, prix NON pose) prouve l'honnetete du MRR (null n'est jamais un faux 0).
const fakePoolForList = {
  async query(sql) {
    const s = String(sql);
    if (/from clients/i.test(s)) return { rows: [
      { id: 'fungalaxy', name: 'Fun Galaxy', status: 'active', plan: 'standard', monthly_price: '490.00', contact_email: '', contact_phone: '', notes: '', created_at: new Date('2026-01-01') },
      { id: 'bowling-du-lac', name: 'Bowling du Lac', status: 'suspended', plan: 'standard', monthly_price: '200.00', contact_email: 'a@b.be', contact_phone: '', notes: '', created_at: new Date('2026-07-20') },
      { id: 'solo-null', name: 'Client Sans Prix', status: 'active', plan: 'standard', monthly_price: null, contact_email: '', contact_phone: '', notes: '', created_at: new Date('2026-07-21') },
    ] };
    if (/from centers/i.test(s)) return { rows: [
      { id: 'libramont', name: 'Fun Galaxy Libramont', status: 'active', client_id: 'fungalaxy' },
      { id: 'gembloux', name: 'Fun Galaxy Gembloux', status: 'active', client_id: 'fungalaxy' },
      { id: 'lac-centre', name: 'Bowling du Lac Centre', status: 'planned', client_id: 'bowling-du-lac' },
    ] };
    if (/from reservations/i.test(s)) return { rows: reservationRevenueRows(s) };
    if (/from staff_members/i.test(s)) return { rows: [{ center_id: 'libramont', n: 4 }, { center_id: 'gembloux', n: 2 }] };
    return { rows: [] };
  },
};

const platformClientsPath = resolve('lib/platform-clients.js');
const { buildPlatformClients, provisionClient, updateClientStatus, setClientBilling } = require(platformClientsPath);

function freshPlatformClients() {
  delete require.cache[platformClientsPath];
  return require(platformClientsPath);
}

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
  ok('3 clients listes', view.clients.length === 3, `${view.clients.length}`);
  const fg = view.clients.find((c) => c.id === 'fungalaxy');
  const bdl = view.clients.find((c) => c.id === 'bowling-du-lac');
  const solo = view.clients.find((c) => c.id === 'solo-null');
  ok('Fun Galaxy a 2 centres', fg && fg.centerCount === 2, fg && String(fg.centerCount));
  ok('effectif Fun Galaxy = 6 (4+2)', fg && fg.staffCount === 6, fg && String(fg.staffCount));
  ok('testData present (SaaS non lance)', view.testData === true);

  console.log('\n[F] Prix mensuel et CA reel par client');
  ok('monthlyPrice expose (fungalaxy 490)', fg && fg.monthlyPrice === 490, fg && String(fg.monthlyPrice));
  ok('monthlyPrice pose meme pour un client non actif (bowling-du-lac 200)', bdl && bdl.monthlyPrice === 200, bdl && String(bdl.monthlyPrice));
  ok('monthlyPrice NULL preserve (solo-null a definir, jamais un faux 0)', solo && solo.monthlyPrice === null, solo && String(solo.monthlyPrice));
  ok('revenue30d client = somme du CA de SES centres (fungalaxy 150+30=180)', fg && fg.revenue30d === 180, fg && String(fg.revenue30d));
  ok('revenue30d exclut simulation / annulee / hors 30 j (fungalaxy 180, pas 180+200+999+777)', fg && fg.revenue30d === 180);
  ok('client sans activite : revenue30d 0 (bowling-du-lac, centre planifie)', bdl && bdl.revenue30d === 0, bdl && String(bdl.revenue30d));

  console.log('\n[G] Agregat plateforme : MRR honnete, clients/centres actifs, CA total');
  const p = view.platform || {};
  ok('MRR = somme des prix des clients ACTIFS uniquement (fungalaxy 490 ; suspendu exclu)', p.mrr === 490, String(p.mrr));
  ok('MRR honnete : solo-null est ACTIF mais sans prix -> compte comme 0, aucun chiffre fabrique', p.mrr === 490);
  ok('activeClients = 2 (fungalaxy + solo-null ; le suspendu exclu)', p.activeClients === 2, String(p.activeClients));
  ok('activeCenters = 2 (libramont + gembloux actifs ; lac-centre planifie exclu)', p.activeCenters === 2, String(p.activeCenters));
  ok('revenue30dAll = 180 (CA reel tous centres, memes exclusions)', p.revenue30dAll === 180, String(p.revenue30dAll));
  ok('clientsWithPrice = 2 (nombre de prix REELLEMENT poses ; solo-null exclu)', p.clientsWithPrice === 2, String(p.clientsWithPrice));

  console.log('\n[H] setClientBilling : borne et efface le prix, gate applicatif');
  let billThrew = false;
  try { await setClientBilling(makeProvisionPool(), { clientId: 'BAD SLUG', monthlyPrice: 100 }); } catch (e) { billThrew = e.expose === true; }
  ok('id client invalide rejete (expose)', billThrew);
  billThrew = false;
  try { await setClientBilling(makeProvisionPool(), { clientId: 'fungalaxy', monthlyPrice: 100001 }); } catch (e) { billThrew = e.expose === true; }
  ok('prix hors borne (>100000) rejete', billThrew);
  billThrew = false;
  try { await setClientBilling(makeProvisionPool(), { clientId: 'fungalaxy', monthlyPrice: -1 }); } catch (e) { billThrew = e.expose === true; }
  ok('prix negatif rejete', billThrew);
  const setOk = await setClientBilling(makeProvisionPool(), { clientId: 'fungalaxy', monthlyPrice: 549.9 });
  ok('prix valide applique (549.9)', setOk && setOk.monthlyPrice === 549.9, setOk && String(setOk.monthlyPrice));
  const cleared = await setClientBilling(makeProvisionPool(), { clientId: 'fungalaxy', monthlyPrice: '' });
  ok('prix efface (vide -> null, retour a "a definir")', cleared && cleared.monthlyPrice === null, cleared && String(cleared.monthlyPrice));

  console.log('\n[I] contre-preuve par MUTATION : le gate sait rougir, puis restauration inverse');
  async function withMutation(anchor, replacement, probe, label) {
    const original = fs.readFileSync(platformClientsPath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`platform-clients-check: ancre de mutation introuvable ou ambigue (${occurrences} occurrence(s)) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    fs.writeFileSync(platformClientsPath, mutated);
    let holds = true;
    try {
      holds = await probe(freshPlatformClients());
    } finally {
      // Restauration par EDITION INVERSE : reecriture du contenu d'origine.
      fs.writeFileSync(platformClientsPath, original);
    }
    if (holds) {
      console.error(`platform-clients-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(`mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`, true);
    const restoredHolds = await probe(freshPlatformClients());
    ok(`restauration inverse "${label}" : l'invariant tient de nouveau`, restoredHolds);
  }

  const probeMrr = async (mod) => {
    const v = await mod.buildPlatformClients();
    return v.platform && v.platform.mrr === 490;
  };
  const probeRevenue = async (mod) => {
    const v = await mod.buildPlatformClients();
    const f = (v.clients || []).find((c) => c.id === 'fungalaxy');
    return Boolean(f) && f.revenue30d === 180 && v.platform && v.platform.revenue30dAll === 180;
  };

  // MRR qui compte un client SUSPENDU (le filtre statut retire) -> bowling-du-lac
  // (200, suspendu) fuite : MRR passe a 690 -> la sonde (490) rougit.
  await withMutation(
    "c.status === 'active' && c.monthlyPrice ? c.monthlyPrice : 0",
    'c.monthlyPrice ? c.monthlyPrice : 0',
    probeMrr,
    'MRR compte un client suspendu qui a un prix',
  );

  // Exclusion simulation retiree du CA client -> la ligne sim-staff (200)
  // recompte : le CA de fungalaxy passe a 380 -> la sonde (180) rougit.
  await withMutation(
    'and ${simulationSqlExclusion()}',
    'and 1 = 1',
    probeRevenue,
    'exclusion de la simulation retiree du CA par client',
  );

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nplatform-clients-check: ${passed}/${checks.length} verts.`);
  if (failed.length) { console.error(`platform-clients-check: ECHEC (${failed.length} rouge(s)).`); process.exit(1); }
  console.log('platform-clients-check: ALL OK (provisioning cle en main : client + centre + roles + codes uniques ; vue proprietaire correcte)');
  process.exit(0);
})().catch((e) => { console.error('platform-clients-check: exception', e && e.stack || e); process.exit(1); });
