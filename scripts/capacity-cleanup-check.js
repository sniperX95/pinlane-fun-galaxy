// Gate Phase 3 - capacite & coherence (points 2, 3, 4).
// Zero reseau, zero base reelle : le module 'pg' est remplace dans require.cache
// AVANT tout require applicatif (comme tenant-write-scope-check), et api/ops est
// pilote avec des ESPIONS injectes sur ses dependances pour observer l'ordre
// reel des appels, sans DB.
//
// Ce gate PROUVE :
//   [3] forceExtraLaneAtPax est cable : avec le champ = 8, getRequiredLaneCount
//       (pax=8) = normal+1 (borne au total) ; SANS le champ (absent/0/null),
//       le calcul est byte-for-byte l'historique. + contre-preuve par mutation
//       logique (une implementation non cablee donnerait un autre chiffre).
//   [2] api/ops action=plan appelle bien refreshCenterOverrides,
//       refreshFormuleOverrides, refreshCatalog et refreshAvailabilityBlocks
//       AVANT planningAgent (espionnage runtime) + preuve structurelle de source
//       avec contre-preuve par mutation (retirer un refresh casserait la preuve).
//   [4] la garde "pistes orphelines" REFUSE (erreur exposee, aucune ecriture) une
//       reduction de laneCount tant qu'une reservation future non annulee occupe
//       une piste retiree ; laisse passer une reduction sans orphelin ; n'emet
//       AUCUNE requete reservations quand la sauvegarde ne reduit pas laneCount.
//
// Lancement : node scripts/capacity-cleanup-check.js

const path = require('path');
const fs = require('fs');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// -- Faux pool pg, installe avant tout require applicatif (pour api/ops) --------
class InertPool {
  constructor(options = {}) { this.options = options; }
  async query() { return { rows: [], rowCount: 0 }; }
  async connect() { return { query: async () => ({ rows: [], rowCount: 0 }), release() {} }; }
  async end() {}
}
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: InertPool } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/gate';
process.env.DATABASE_SSL = 'disable';

function readProjectFile(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

// ===========================================================================
// [3] forceExtraLaneAtPax cable dans lib/booking-config.js
// ===========================================================================
function testForceExtraLane() {
  console.log('\n[3] forceExtraLaneAtPax cable (lib/booking-config)');
  const bc = require('../lib/booking-config');

  // Doctrine defaut : SANS config (fallback constantes) le calcul est inchange.
  ok(bc.getRequiredLaneCount('bowling', 8) === 2, 'defaut sans config: 8 pax -> 2 pistes (inchange)');
  ok(bc.getRequiredLaneCount('bowling', 55) === 8, 'defaut sans config: 55 pax -> 8 pistes (inchange)');
  ok(bc.getRequiredLaneCount('bowling', 6) === 1, 'defaut sans config: 6 pax -> 1 piste (inchange)');

  // SANS le champ forceExtraLaneAtPax dans la config -> IDENTIQUE a aujourd hui.
  const noForce = { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 };
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, noForce) === 2, 'config sans forceExtra: 8 pax -> 2 (doctrine)');
  ok(bc.getRequiredLaneCount('bowling', 13, undefined, noForce) === 3, 'config sans forceExtra: 13 pax -> 3 (doctrine)');

  // AVEC forceExtraLaneAtPax = 8 -> une piste de plus a partir du seuil.
  const withForce = { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8 };
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, withForce) === 3, 'forceExtra=8: 8 pax -> normal(2)+1 = 3');
  ok(bc.getRequiredLaneCount('bowling', 7, undefined, withForce) === 2, 'forceExtra=8: 7 pax (< seuil) -> inchange (2)');
  ok(bc.getRequiredLaneCount('bowling', 13, undefined, withForce) === 4, 'forceExtra=8: 13 pax -> normal(3)+1 = 4');

  // Borne au nombre total de pistes : +1 ne depasse JAMAIS laneCount.
  ok(bc.getRequiredLaneCount('bowling', 48, undefined, withForce) === 8, 'forceExtra=8: 48 pax (deja 8 pistes) -> borne a 8, jamais 9');
  ok(bc.getRequiredLaneCount('bowling', 55, undefined, withForce) === 8, 'forceExtra=8: 55 pax -> borne a 8');

  // Seuil neutralise (0 / null / negatif / NaN) -> comportement historique.
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, { ...noForce, forceExtraLaneAtPax: 0 }) === 2, 'forceExtra=0 -> neutre');
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, { ...noForce, forceExtraLaneAtPax: null }) === 2, 'forceExtra=null -> neutre');
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, { ...noForce, forceExtraLaneAtPax: -3 }) === 2, 'forceExtra<0 -> neutre');

  // resolveBowlingCapacity expose bien le seuil normalise (0 si absent/invalide).
  ok(bc.resolveBowlingCapacity(withForce).forceExtraLaneAtPax === 8, 'resolveBowlingCapacity expose forceExtraLaneAtPax=8');
  ok(bc.resolveBowlingCapacity(noForce).forceExtraLaneAtPax === 0, 'resolveBowlingCapacity: champ absent -> 0');
  ok(bc.resolveBowlingCapacity(null).forceExtraLaneAtPax === 0, 'resolveBowlingCapacity(null) -> 0');

  // Un seuil bas ne double pas la piste : on ajoute UNE seule piste, pas +1 par tranche.
  const lowSeuil = { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 1 };
  ok(bc.getRequiredLaneCount('bowling', 6, undefined, lowSeuil) === 2, 'forceExtra=1: 6 pax -> normal(1)+1 = 2 (une seule piste ajoutee)');

  // SCOPING : forceExtra vaut pour le BOWLING DIRECT, PAS pour une formule (package
  // fixe). Ainsi la disponibilite et le prix des formules existantes ne bougent pas
  // (doctrine defaut = inchange, et run-ops-tests formula-availability reste vert).
  ok(bc.getRequiredLaneCount('bowling', 10, '', withForce) === 3, 'bowling direct 10 pax + forceExtra=8 -> 3 (piste de confort)');
  ok(bc.getRequiredLaneCount('formule', 10, 'f1', withForce) === 2, 'formule f1 10 pax + forceExtra=8 -> 2 (INCHANGE : pas de confort sur les formules)');
  ok(bc.getRequiredLaneCount('formule', 10, 'f1', withForce) === bc.getRequiredLaneCount('formule', 10, 'f1', noForce),
    'contre-preuve scoping: une formule rend le meme nombre de pistes avec ou sans forceExtra');

  // Contre-preuve par MUTATION LOGIQUE : une implementation NON cablee (qui
  // ignore forceExtra) rendrait 2 pour 8 pax avec forceExtra=8. La vraie rend 3.
  // Si le cablage saute un jour, les assertions ci-dessus virent au rouge.
  const uncabled = (pax, cfg) => {
    const n = Math.ceil(pax / cfg.normalCapacityPerLane);
    return (n > cfg.laneCount && pax <= cfg.laneCount * cfg.emergencyCapacityPerLane) ? cfg.laneCount : n;
  };
  ok(uncabled(8, withForce) === 2 && bc.getRequiredLaneCount('bowling', 8, undefined, withForce) === 3,
    'contre-preuve mutation: non-cable=2, cable=3 (le champ change bien le calcul)');
}

// ===========================================================================
// [4] Garde pistes orphelines dans lib/center-config.saveCenterConfigOverride
// ===========================================================================
function makeCenterPool(orphans, log) {
  return {
    async query(text, params = []) {
      const sql = String(text);
      log.push({ sql, params });
      if (/select\s+settings\s+from\s+centers/i.test(sql)) {
        // Config existante : baseline libramont (laneCount 8) via config vide.
        return { rows: [{ settings: { config: {} } }], rowCount: 1 };
      }
      if (/from\s+reservations/i.test(sql) && /unnest\(lanes\)/i.test(sql)) {
        return { rows: orphans, rowCount: orphans.length };
      }
      if (/update\s+centers/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

async function testOrphanGuard() {
  console.log('\n[4] Garde pistes orphelines (lib/center-config)');
  const cc = require('../lib/center-config');

  // A. Reduction 8 -> 6 AVEC une reservation future sur les pistes 7,8 -> REFUS.
  {
    const log = [];
    const pool = makeCenterPool([{ id: 42, date_str: '2026-07-25', orphan_lanes: [7, 8] }], log);
    let error = null;
    try {
      await cc.saveCenterConfigOverride(pool, 'libramont', { resources: { bowling: { laneCount: 6 } } });
    } catch (e) { error = e; }
    ok(error instanceof Error, 'reduction avec orphelin: leve une erreur');
    ok(error && error.expose === true, `erreur EXPOSEE au staff (obtenu expose=${error && error.expose})`);
    ok(error && /refus/i.test(error.message) && error.message.includes('6') && error.message.includes('2026-07-25'),
      `message clair (piste au-dela de 6, date, pistes) : ${error && JSON.stringify(error.message)}`);
    ok(!log.some((q) => /update\s+centers/i.test(q.sql)), 'AUCUNE ecriture (update centers) apres le refus');
    // La requete d orphelins exclut bien les annulations (teeth du predicat).
    const orphanQuery = log.find((q) => /from\s+reservations/i.test(q.sql));
    ok(orphanQuery && /status\s*<>\s*'cancelled'/i.test(orphanQuery.sql),
      'la requete ignore les reservations annulees (status <> cancelled)');
    ok(orphanQuery && /date\s*>=/i.test(orphanQuery.sql),
      'la requete ne regarde QUE les reservations futures (date >=)');
  }

  // B. Reduction 8 -> 6 SANS orphelin -> passe, ecrit, rend laneCount 6.
  {
    const log = [];
    const pool = makeCenterPool([], log);
    let result = null; let error = null;
    try {
      result = await cc.saveCenterConfigOverride(pool, 'libramont', { resources: { bowling: { laneCount: 6 } } });
    } catch (e) { error = e; }
    ok(!error, `reduction sans orphelin: aucun refus (${error && error.message})`);
    ok(result && Number(result.resources.bowling.laneCount) === 6, 'la reduction a 6 pistes est bien enregistree');
    ok(log.some((q) => /from\s+reservations/i.test(q.sql)), 'la garde a bien interroge les reservations (elle a tourne)');
    ok(log.some((q) => /update\s+centers/i.test(q.sql)), 'la config est ecrite quand il n y a pas d orphelin');
  }

  // C. Sauvegarde SANS reduction de laneCount -> aucune requete reservations.
  {
    const log = [];
    const pool = makeCenterPool([{ id: 1, date_str: '2026-07-25', orphan_lanes: [7] }], log);
    let error = null;
    try {
      // On ne touche pas laneCount (patch statut only) : pas de reduction.
      await cc.saveCenterConfigOverride(pool, 'libramont', { status: 'planned' });
    } catch (e) { error = e; }
    ok(!error, `sauvegarde sans reduction: pas de refus (${error && error.message})`);
    ok(!log.some((q) => /from\s+reservations/i.test(q.sql)),
      'AUCUNE requete reservations quand laneCount ne baisse pas (garde ciblee)');
    ok(log.some((q) => /update\s+centers/i.test(q.sql)), 'la sauvegarde non reductrice ecrit normalement');
  }

  // D. Augmentation de laneCount (6 -> 12) -> pas une reduction -> pas de garde.
  {
    const log = [];
    const pool = makeCenterPool([{ id: 1, date_str: '2026-07-25', orphan_lanes: [9] }], log);
    let error = null;
    try {
      await cc.saveCenterConfigOverride(pool, 'libramont', { resources: { bowling: { laneCount: 12 } } });
    } catch (e) { error = e; }
    ok(!error, `augmentation laneCount: pas de refus (${error && error.message})`);
    ok(!log.some((q) => /from\s+reservations/i.test(q.sql)), 'aucune requete reservations sur une AUGMENTATION');
  }
}

// ===========================================================================
// [2] api/ops action=plan : refresh fail-soft AVANT planningAgent
// ===========================================================================
async function testPlanRefreshRuntime() {
  console.log('\n[2] api/ops action=plan : refresh AVANT planningAgent (runtime)');

  const calls = [];
  const spy = (name, ret) => async () => { calls.push(name); return typeof ret === 'function' ? ret() : ret; };

  // Espions poses sur les dependances AVANT de charger api/ops (qui les
  // destructure a son chargement). On garde les autres exports intacts.
  const opsKnowledge = require('../lib/ops-knowledge');
  opsKnowledge.refreshCenterOverrides = spy('refreshCenterOverrides');
  opsKnowledge.refreshCatalog = spy('refreshCatalog');

  const bookingConfig = require('../lib/booking-config');
  bookingConfig.refreshFormuleOverrides = spy('refreshFormuleOverrides');

  const availabilityBlocks = require('../lib/availability-blocks');
  availabilityBlocks.refreshAvailabilityBlocks = spy('refreshAvailabilityBlocks');

  const opsAgents = require('../lib/ops-agents');
  opsAgents.planningAgent = (body, context) => { calls.push('planningAgent'); return { ok: true, mockedPlan: true }; };

  const http = require('../lib/http');
  http.setCors = () => {};
  const captured = { code: 0, body: null };
  http.sendJson = (res, code, obj) => { captured.code = code; captured.body = obj; };
  http.sendError = (res, code, msg) => { captured.code = code; captured.body = { error: msg }; };
  http.readJson = async () => ({ action: 'plan', centerId: 'libramont', date: '2026-07-22', reservations: [], laneStatuses: {} });

  const staffAuth = require('../lib/staff-auth');
  staffAuth.requireStaffPermission = async () => ({ authorizedCenterId: 'libramont', centerId: 'libramont', member: { id: 'qa', name: 'QA' } });

  const opsHandler = require('../api/ops');

  const req = { method: 'POST', url: '/api/ops?action=plan', headers: { host: 'localhost' } };
  const res = { statusCode: 0, setHeader() {}, getHeader() {}, write() {}, end() {} };
  await opsHandler(req, res);

  // Anti-faux-vert : sans avoir REELLEMENT traverse le handler, le test ne prouve
  // rien. On exige que planningAgent ait ete appele (le plan a bien tourne).
  const planIdx = calls.indexOf('planningAgent');
  if (!ok(planIdx >= 0, `le handler action=plan a bien atteint planningAgent (calls=${JSON.stringify(calls)})`)) {
    return;
  }

  for (const refresh of ['refreshCenterOverrides', 'refreshFormuleOverrides', 'refreshCatalog', 'refreshAvailabilityBlocks']) {
    const idx = calls.indexOf(refresh);
    ok(idx >= 0, `${refresh} est invoque par action=plan`);
    ok(idx >= 0 && idx < planIdx, `${refresh} est invoque AVANT planningAgent (idx ${idx} < ${planIdx})`);
  }
  ok(captured.code === 200 && captured.body && captured.body.mockedPlan === true,
    'le plan repond 200 avec le resultat du planningAgent');

  // -- Preuve structurelle + contre-preuve par mutation (source) --------------
  const opsSource = readProjectFile('api/ops.js');
  const start = opsSource.indexOf("if (action === 'plan')");
  const planBlock = opsSource.slice(start, opsSource.indexOf('planningAgent(', start));
  const refreshesPresent = ['refreshCenterOverrides', 'refreshFormuleOverrides', 'refreshCatalog', 'refreshAvailabilityBlocks']
    .every((fn) => planBlock.includes(`${fn}(`));
  ok(refreshesPresent, 'les 4 refresh apparaissent dans la source AVANT planningAgent');

  // Contre-preuve : une version MUTEE du bloc (refresh retire) ne satisferait plus
  // l assertion -> preuve que l assertion a des dents.
  const mutated = planBlock.replace(/await\s+refreshCenterOverrides\(planPool\);/, '/* mute */');
  const mutatedStillOk = ['refreshCenterOverrides', 'refreshFormuleOverrides', 'refreshCatalog', 'refreshAvailabilityBlocks']
    .every((fn) => mutated.includes(`${fn}(`));
  ok(mutated !== planBlock && !mutatedStillOk,
    'contre-preuve mutation: retirer refreshCenterOverrides ferait echouer la preuve structurelle');
}

(async () => {
  try {
    testForceExtraLane();
    await testOrphanGuard();
    await testPlanRefreshRuntime();
  } catch (error) {
    console.error('\ncapacity-cleanup-check: exception', error && (error.stack || error.message));
    failures += 1;
  }
  if (failures) { console.error(`\ncapacity-cleanup-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ncapacity-cleanup-check: ALL OK');
})();
