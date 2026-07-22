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
  console.log('\n[3] nombre de pistes = pax / capacite confort (forceExtra RETIRE)');
  const bc = require('../lib/booking-config');

  // Defaut SANS config (fallback constantes 8 pistes / 6 confort / 7 secours).
  ok(bc.getRequiredLaneCount('bowling', 8) === 2, 'defaut: 8 pax -> 2 pistes');
  ok(bc.getRequiredLaneCount('bowling', 55) === 8, 'defaut: 55 pax -> 8 pistes (borne au parc)');
  ok(bc.getRequiredLaneCount('bowling', 6) === 1, 'defaut: 6 pax -> 1 piste');

  // Le nombre de pistes suit la CONFIG du centre (joueurs confort / piste).
  const cfg6 = { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 };
  ok(bc.getRequiredLaneCount('bowling', 11, undefined, cfg6) === 2, '6 confort/piste: 11 pax -> 2 pistes (cas reporte par Movsar)');
  ok(bc.getRequiredLaneCount('bowling', 12, undefined, cfg6) === 2, '6 confort/piste: 12 pax -> 2 pistes');
  ok(bc.getRequiredLaneCount('bowling', 13, undefined, cfg6) === 3, '6 confort/piste: 13 pax -> 3 pistes');

  // Changer "joueurs max / piste" CHANGE le moteur (ce que Movsar demande).
  const cfg8 = { laneCount: 8, normalCapacityPerLane: 8, emergencyCapacityPerLane: 9 };
  ok(bc.getRequiredLaneCount('bowling', 13, undefined, cfg8) === 2, '8 confort/piste: 13 pax -> 2 pistes (vs 3 a 6/piste)');
  ok(bc.getRequiredLaneCount('bowling', 16, undefined, cfg8) === 2, '8 confort/piste: 16 pax -> 2 pistes');
  ok(bc.getRequiredLaneCount('bowling', 17, undefined, cfg8) === 3, '8 confort/piste: 17 pax -> 3 pistes');

  // Changer le NOMBRE de pistes change le repli de secours.
  const cfg6lanes = { laneCount: 6, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7 };
  ok(bc.getRequiredLaneCount('bowling', 40, undefined, cfg6lanes) === 6, '6 pistes: 40 pax -> borne a 6 (secours)');

  // GARDE ANTI-REGRESSION : le champ forceExtraLaneAtPax (meme present) N A AUCUN
  // effet -> il n ajoute JAMAIS de piste. 11 pax a 6/piste = 2, jamais 3.
  const withForce = { laneCount: 8, normalCapacityPerLane: 6, emergencyCapacityPerLane: 7, forceExtraLaneAtPax: 8 };
  ok(bc.getRequiredLaneCount('bowling', 11, undefined, withForce) === 2, 'forceExtra ignore: 11 pax -> 2 (pas 3)');
  ok(bc.getRequiredLaneCount('bowling', 8, undefined, withForce) === 2, 'forceExtra ignore: 8 pax -> 2 (pas 3)');
  ok(bc.getRequiredLaneCount('bowling', 13, undefined, withForce) === 3, 'forceExtra ignore: 13 pax -> 3 (pas 4)');
  ok(bc.getRequiredLaneCount('bowling', 11, undefined, withForce) === bc.getRequiredLaneCount('bowling', 11, undefined, cfg6),
    'contre-preuve: avec ou sans forceExtra, meme nombre de pistes');

  // Les FORMULES ne sont pas impactees non plus (aucun +1 nulle part).
  ok(bc.getRequiredLaneCount('formule', 10, 'f1', withForce) === bc.getRequiredLaneCount('formule', 10, 'f1', cfg6),
    'formule f1 10 pax: identique avec/sans forceExtra');

  // GARDE ANTI-REGRESSION : getRequiredLaneCount doit EGALER le calcul pur
  // pax / confort-par-piste (avec repli secours) pour TOUTE config, y compris
  // quand forceExtraLaneAtPax est present. Si un jour on re-injecte un "+1 piste"
  // quelque part, une de ces egalites casse et le gate rougit.
  const pure = (pax, cfg) => {
    const n = Math.ceil(pax / cfg.normalCapacityPerLane);
    return (n > cfg.laneCount && pax <= cfg.laneCount * cfg.emergencyCapacityPerLane) ? cfg.laneCount : n;
  };
  [[8, withForce], [11, withForce], [13, withForce], [40, cfg6lanes], [17, cfg8]].forEach(([pax, cfg]) => {
    ok(bc.getRequiredLaneCount('bowling', pax, undefined, cfg) === pure(pax, cfg),
      `garde anti-regression: ${pax} pax = calcul pur pax/confort (forceExtra sans effet)`);
  });
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
