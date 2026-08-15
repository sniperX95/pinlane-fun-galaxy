// Gate du CRUD CATALOGUE (phase 2b-1, lib/catalog-store.js). PROUVE, sur le VRAI
// store, avec un pool mock qui OBEIT au SQL (INSERT / UPDATE / DELETE / SELECT
// sur les 3 tables formulas / formula_steps / activities) :
//
//   1. createFormula custom + steps -> getFormulaDoc/getBookingFormule au bon
//      format, getBasePrice calcule son prix, ops-engine.getFormulaAnchorModel
//      lit ses steps, elle est reservable (getEffectiveFormules).
//   2. setFormulaSteps change la composition -> getFormulaDoc.steps reflete la
//      nouvelle liste ordonnee ; ajouter un step bowling fait passer
//      reservationNeedsLanes / getRequiredLaneCount a > 0 (recable 2a n2).
//   3. deleteFormula (soft) -> disparait de getEffectiveFormules /
//      listBookingFormules, getFormula/getFormulaDoc rendent null, et N'EST PAS
//      ressuscitee par le fallback fichier (fix 2a n1, isFormulaKnown).
//   4. updateFormula patch prix/nom -> reflete.
//   5. DOCTRINE : sans aucune ecriture (seed only), tout est IDENTIQUE a 2a
//      (getBasePrice au centime, getFormuleAvailability, ancrage).
//   6. activites CRUD : createActivity custom -> getActivityDoc la retourne ; un
//      step qui la reference est valide.
//   + 2 contre-preuves par MUTATION du code (edition inverse, jamais git) :
//      neutraliser le fix no-resurrect (ops-knowledge) fait rougir le check 3 ;
//      neutraliser la lecture store dans reservationNeedsLanes (booking-config)
//      fait rougir le check 2.
//
// Lancement : node scripts/catalog-crud-check.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const storePath = path.join(ROOT, 'lib', 'catalog-store.js');
const opsKnowledgePath = path.join(ROOT, 'lib', 'ops-knowledge.js');
const bookingConfigPath = path.join(ROOT, 'lib', 'booking-config.js');

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}
function deepEq(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch (error) { return false; }
}

// Le socle : les VRAIS fichiers.
const FORMULES = require(path.join(ROOT, 'lib', 'booking-config')).FORMULES;
const DOC_FORMULAS = require(path.join(ROOT, 'ops-knowledge', 'formulas.json')).formulas;
const docById = new Map(DOC_FORMULAS.map((doc) => [doc.id, doc]));

const store = require(storePath);
const bc = require(bookingConfigPath);
const opsKnowledge = require(opsKnowledgePath);
const { getFormulaAnchorModel } = require(path.join(ROOT, 'lib', 'ops-engine'));
const { buildSeedRows } = require(path.join(ROOT, 'scripts', 'backfill-catalog'));

// ── Lignes seed typees "pg" (numeric -> chaine, comme le retour d'un select) ──
function pgFormulaRow(row) {
  return {
    ...row,
    price_value: row.price_value == null ? null : String(row.price_value),
    price_old: row.price_old == null ? null : String(row.price_old),
  };
}
function seedState() {
  const seed = buildSeedRows();
  return {
    formulas: seed.formulas.map(pgFormulaRow),
    steps: seed.steps.map((step) => ({ ...step })),
    activities: seed.activities.map((activity) => ({ ...activity })),
  };
}

// ── Pool mock qui OBEIT au SQL (INSERT / UPDATE / DELETE / SELECT) ────────────
// Il maintient les 3 tables en memoire et applique les ecritures des fonctions
// CRUD par leur texte SQL + params positionnels. connect() partage les memes
// tables (transactions), BEGIN/COMMIT/ROLLBACK sont des no-op.
// Univers simule POST-migration 0041 : la FakePool repond aux SELECT etendus
// (order_constraints, pax, optional), le store leve donc son drapeau de
// capacite et ecrit la forme etendue. Les listes de colonnes suivent la MEME
// forme, sinon le mappage positionnel decale tout apres order_policy.
const FORMULA_COLS = ['id', 'name', 'family', 'min_pax', 'price_type', 'price_value', 'price_old',
  'not_during_holidays', 'valid_days', 'time_limit_min_minutes', 'time_limit_max_minutes',
  'human_validation', 'order_policy', 'order_constraints', 'is_birthday_formula', 'best', 'description_lines',
  'sort_index', 'source', 'active'];
const STEP_COLS = ['formula_id', 'position', 'activity_id', 'count', 'duration_minutes', 'label', 'critical', 'resource_type', 'pax', 'optional'];
const ACTIVITY_COLS = ['id', 'center_id', 'name', 'resource_type', 'duration_model', 'service_model',
  'risk_drivers', 'planning_pressure', 'bookable', 'price_type', 'price_value', 'price_unit',
  'booking_order', 'source', 'active'];

function rowFromParams(cols, params) {
  const row = {};
  cols.forEach((col, index) => { row[col] = params[index]; });
  return row;
}

class MockPool {
  constructor(state) {
    this.t = {
      formulas: (state.formulas || []).map((r) => ({ ...r })),
      steps: (state.steps || []).map((r) => ({ ...r })),
      activities: (state.activities || []).map((r) => ({ ...r })),
    };
    this.queries = 0;
  }
  async query(text, params = []) { return this._run(text, params); }
  async connect() {
    const self = this;
    return { query: (text, params = []) => self._run(text, params), release() {} };
  }
  _upsert(list, row, keyOf) {
    const key = keyOf(row);
    const index = list.findIndex((existing) => keyOf(existing) === key);
    if (index === -1) list.push(row);
    else list[index] = row;
  }
  _run(text, params = []) {
    this.queries += 1;
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback)/i.test(sql)) return { rows: [], rowCount: 0 };

    if (/insert into formula_steps/i.test(sql)) {
      const row = rowFromParams(STEP_COLS, params);
      this._upsert(this.t.steps, row, (r) => `${r.formula_id}|${r.position}`);
      return { rows: [], rowCount: 1 };
    }
    if (/delete from formula_steps/i.test(sql)) {
      const fid = params[0];
      const before = this.t.steps.length;
      this.t.steps = this.t.steps.filter((r) => r.formula_id !== fid);
      return { rows: [], rowCount: before - this.t.steps.length };
    }
    if (/insert into formulas/i.test(sql)) {
      const row = rowFromParams(FORMULA_COLS, params);
      // jsonb : le pilote pg rend un TABLEAU, pas la chaine passee en insert.
      row.order_constraints = row.order_constraints == null ? null : JSON.parse(row.order_constraints);
      this._upsert(this.t.formulas, row, (r) => r.id);
      return { rows: [], rowCount: 1 };
    }
    if (/insert into activities/i.test(sql)) {
      const row = rowFromParams(ACTIVITY_COLS, params);
      // jsonb : le pilote pg rend un OBJET, pas la chaine passee en insert.
      row.duration_model = row.duration_model == null ? null : JSON.parse(row.duration_model);
      row.service_model = row.service_model == null ? null : JSON.parse(row.service_model);
      this._upsert(this.t.activities, row, (r) => `${r.id}|${r.center_id}`);
      return { rows: [], rowCount: 1 };
    }
    // SELECTs
    if (/from formula_steps/i.test(sql)) {
      const rows = this.t.steps.slice().sort((a, b) => (a.formula_id < b.formula_id ? -1 : a.formula_id > b.formula_id ? 1 : Number(a.position) - Number(b.position)));
      return { rows, rowCount: rows.length };
    }
    if (/from formulas/i.test(sql)) {
      if (/where id = \$1/i.test(sql)) {
        const rows = this.t.formulas.filter((r) => r.id === params[0]);
        return { rows, rowCount: rows.length };
      }
      return { rows: this.t.formulas.slice(), rowCount: this.t.formulas.length };
    }
    if (/from activities/i.test(sql)) {
      if (/where id = \$1/i.test(sql)) {
        const rows = this.t.activities.filter((r) => r.id === params[0] && r.center_id === params[1]);
        return { rows, rowCount: rows.length };
      }
      return { rows: this.t.activities.slice(), rowCount: this.t.activities.length };
    }
    return { rows: [], rowCount: 0 };
  }
}

// ── Sondes d'identite (doctrine) ─────────────────────────────────────────────
const PROBE_DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-07-21'];
const PROBE_TIMES = ['09:00', '11:00', '13:00', '17:00', '18:00', '20:00', '21:00'];
const PROBE_PAX = [1, 6, 10];

function availabilityIdentityHolds() {
  for (const fileFormule of FORMULES) {
    const storeFormule = store.getBookingFormule(fileFormule.id);
    if (!storeFormule) return false;
    for (const date of PROBE_DATES) {
      for (const time of PROBE_TIMES) {
        for (const pax of PROBE_PAX) {
          const a = bc.getFormuleAvailability(storeFormule, date, pax, time);
          const b = bc.getFormuleAvailability(fileFormule, date, pax, time);
          if (a.ok !== b.ok || a.message !== b.message) return false;
        }
      }
    }
  }
  return true;
}
function expectedBasePrice(fileFormule, pax, laneCount) {
  return fileFormule.type === 'per_lane' ? fileFormule.price * laneCount : fileFormule.price * pax;
}

async function loadFromSeed() {
  const pool = new MockPool(seedState());
  bc.setFormuleOverrides(new Map());
  await store.refreshCatalog(pool, { force: true });
  return pool;
}

(async () => {
  // =========================================================================
  console.log('[5] DOCTRINE : seed only (aucune ecriture) == comportement 2a');
  // =========================================================================
  await loadFromSeed();
  let docFail = 0;
  for (const rawDoc of DOC_FORMULAS) {
    if (!deepEq(store.getFormulaDoc(rawDoc.id), rawDoc)) { docFail += 1; console.log(`    doc mismatch: ${rawDoc.id}`); }
  }
  ok(docFail === 0, 'getFormulaDoc(seed) == ops-knowledge/formulas.json (deep-equal, steps compris)');

  let priceFail = 0;
  for (const fileFormule of FORMULES) {
    for (const pax of PROBE_PAX) {
      for (const laneCount of [1, 2, 3]) {
        const expected = expectedBasePrice(fileFormule, pax, laneCount);
        const actual = bc.getBasePrice('formule', 0, laneCount, pax, fileFormule.id);
        if (actual !== expected) { priceFail += 1; console.log(`    price mismatch ${fileFormule.id}`); }
      }
    }
  }
  ok(priceFail === 0, 'getBasePrice(seed) == prix fichier au centime (per_pax et per_lane)');
  ok(availabilityIdentityHolds(), 'getFormuleAvailability(seed) == verdicts fichier (grille complete)');
  let anchorFail = 0;
  for (const rawDoc of DOC_FORMULAS) {
    if (!deepEq(getFormulaAnchorModel(store.getFormulaDoc(rawDoc.id)), getFormulaAnchorModel(rawDoc))) anchorFail += 1;
  }
  ok(anchorFail === 0, 'getFormulaAnchorModel(getFormulaDoc) == fichier (14 formules)');
  ok(store.listBookingFormules().length === FORMULES.length, `listBookingFormules == ${FORMULES.length} formules (aucune ecriture)`);

  // =========================================================================
  console.log('\n[1] createFormula custom + steps');
  // =========================================================================
  const pool1 = await loadFromSeed();
  const created = await store.createFormula(pool1, {
    id: 'crud-mega',
    name: 'FORMULE MEGA',
    family: 'Formules speciales',
    priceType: 'per_pax',
    priceValue: 42,
    priceOld: 60,
    minPax: 4,
    validDays: [5],
    descriptionLines: ['1h de Bowling', '2 parties Laser Game'],
    steps: [
      { activityId: 'bowling', count: 1, durationMinutes: 60, critical: true },
      { activityId: 'laser_game', count: 2, durationMinutes: 25 },
      { activityId: 'service_drinks', count: 2, label: '2 cruches', resourceType: 'bar_service', durationMinutes: 5 },
    ],
  });
  ok(created && created.id === 'crud-mega' && created.source === 'custom', 'createFormula rend {id, source:custom}');
  const megaDoc = store.getFormulaDoc('crud-mega');
  ok(megaDoc && megaDoc.name === 'FORMULE MEGA' && megaDoc.steps.length === 3
    && megaDoc.steps[0].activityId === 'bowling' && megaDoc.steps[1].activityId === 'laser_game',
  'getFormulaDoc(custom) : format ops-knowledge avec ses steps ordonnes');
  const megaBooking = store.getBookingFormule('crud-mega');
  ok(megaBooking && megaBooking.price === 42 && megaBooking.type === 'per_pax'
    && megaBooking.oldPrice === 60 && megaBooking.hasBowling === true,
  'getBookingFormule(custom) : format booking, prix/type/oldPrice, hasBowling derive des steps');
  ok(bc.getBasePrice('formule', 0, 0, 10, 'crud-mega') === 420, `getBasePrice(custom, 10 pax) = 420 (obtenu ${bc.getBasePrice('formule', 0, 0, 10, 'crud-mega')})`);
  const megaAnchors = getFormulaAnchorModel(megaDoc).anchors.map((a) => a.activityId);
  ok(megaAnchors.includes('bowling') && megaAnchors.includes('laser_game'), `ancrage lit les steps (ancres: ${megaAnchors.join(',')})`);
  ok(bc.getEffectiveFormules('libramont').some((f) => f.id === 'crud-mega'), 'custom reservable (apparait dans getEffectiveFormules)');
  // Slug auto + refus de collision seed
  const auto = await store.createFormula(pool1, { name: 'Sans Id Precis', priceType: 'per_pax', priceValue: 10, steps: [{ activityId: 'laser_game', count: 1 }] });
  ok(auto.id === 'sans-id-precis' && store.getFormulaDoc(auto.id), `id slug auto genere (${auto.id})`);
  let refusedSeed = false;
  try { await store.createFormula(pool1, { id: 'f1', name: 'X', priceType: 'per_pax', priceValue: 10, steps: [{ activityId: 'bowling' }] }); }
  catch (error) { refusedSeed = error.expose === true; }
  ok(refusedSeed, 'createFormula refuse un id qui collisionne un seed (f1)');
  let refusedBounds = false;
  try { await store.createFormula(pool1, { name: 'Y', priceType: 'per_pax', priceValue: 5000, steps: [{ activityId: 'bowling' }] }); }
  catch (error) { refusedBounds = error.expose === true; }
  ok(refusedBounds, 'createFormula refuse un prix hors bornes (5000 > 1000)');

  // =========================================================================
  console.log('\n[2] setFormulaSteps change la composition -> lanes');
  // =========================================================================
  const pool2 = await loadFromSeed();
  ok(bc.reservationNeedsLanes('formule', 'f2') === false && bc.getRequiredLaneCount('formule', 10, 'f2') === 0,
    'avant : f2 (sans bowling) ne demande pas de piste');
  await store.setFormulaSteps(pool2, {
    id: 'f2',
    steps: [
      { activityId: 'minigolf_blacklight', count: 1 },
      { activityId: 'laser_game', count: 2, durationMinutes: 25 },
      { activityId: 'bowling', count: 1, durationMinutes: 60, critical: true },
    ],
  });
  const f2Doc = store.getFormulaDoc('f2');
  ok(f2Doc && f2Doc.steps.length === 3 && f2Doc.steps[2].activityId === 'bowling',
    'getFormulaDoc(f2).steps reflete la nouvelle liste ordonnee (bowling ajoute en position 2)');
  ok(bc.reservationNeedsLanes('formule', 'f2') === true, 'apres ajout du step bowling : reservationNeedsLanes(f2) = true');
  ok(bc.getRequiredLaneCount('formule', 10, 'f2') > 0, `apres ajout du step bowling : getRequiredLaneCount(10 pax, f2) > 0 (obtenu ${bc.getRequiredLaneCount('formule', 10, 'f2')})`);
  // Retrait du step bowling : le besoin en pistes retombe
  await store.setFormulaSteps(pool2, { id: 'f2', steps: [{ activityId: 'laser_game', count: 2, durationMinutes: 25 }] });
  ok(bc.reservationNeedsLanes('formule', 'f2') === false, 'retrait du step bowling : reservationNeedsLanes(f2) redevient false');

  // =========================================================================
  console.log('\n[3] deleteFormula (soft) -> retiree, pas ressuscitee');
  // =========================================================================
  const pool3 = await loadFromSeed();
  await store.deleteFormula(pool3, { id: 'f5' });
  ok(store.getFormulaDoc('f5') === null && store.getBookingFormule('f5') === null, 'deleteFormula(soft) : getFormulaDoc/getBookingFormule(f5) rendent null');
  ok(!store.listBookingFormules().some((f) => f.id === 'f5'), 'f5 disparait de listBookingFormules');
  ok(!bc.getEffectiveFormules('libramont').some((f) => f.id === 'f5'), 'f5 disparait de getEffectiveFormules (plus reservable)');
  ok(opsKnowledge.getFormula('f5') === null, 'FIX no-resurrect : ops-knowledge.getFormula(f5) = null (pas de fallback fichier pour une seed DESACTIVEE)');
  ok(bc.getBasePrice('formule', 0, 0, 10, 'f5') === 0, 'getBasePrice(f5) = 0 : la constante FORMULES ne ressuscite pas la formule desactivee');
  ok(store.isFormulaKnown('f5') === true, 'isFormulaKnown(f5) = true (l\'id porte une ligne DB desactivee)');
  // Contraste : DB VIDE (id INCONNU du store) => fallback fichier legitime.
  store.applyCatalogState({});
  ok(deepEq(opsKnowledge.getFormula('f5'), docById.get('f5')), 'DB vide (f5 INCONNU du store) : getFormula(f5) retombe sur le fichier (le fix ne casse pas le fallback des ids inconnus)');

  // =========================================================================
  console.log('\n[4] updateFormula patch prix/nom');
  // =========================================================================
  const pool4 = await loadFromSeed();
  await store.updateFormula(pool4, { id: 'f3', name: 'FORMULE 3 REVUE', priceValue: 33, priceOld: 40 });
  const f3Doc = store.getFormulaDoc('f3');
  const f3Booking = store.getBookingFormule('f3');
  ok(f3Doc && f3Doc.name === 'FORMULE 3 REVUE' && f3Doc.price.value === 33 && f3Doc.price.oldValue === 40, 'updateFormula : getFormulaDoc(f3) reflete nom + prix + ancien prix');
  ok(f3Booking && f3Booking.name === 'FORMULE 3 REVUE' && f3Booking.price === 33, 'updateFormula : getBookingFormule(f3) reflete nom + prix');
  ok(bc.getBasePrice('formule', 0, 0, 6, 'f3') === 33 * 6, `updateFormula : getBasePrice(f3, 6 pax) = ${33 * 6}`);
  // Steps intacts (update ne touche pas les steps)
  ok(deepEq(f3Doc.steps, docById.get('f3').steps), 'updateFormula ne touche pas les steps (identiques au fichier)');

  // =========================================================================
  console.log('\n[6] activites CRUD');
  // =========================================================================
  const pool6 = await loadFromSeed();
  const act = await store.createActivity(pool6, {
    id: 'vr-arena',
    name: 'VR Arena',
    resourceType: 'soft_capacity',
    planningPressure: 'low',
  });
  ok(act && act.id === 'vr-arena', 'createActivity rend {id}');
  const actDoc = store.getActivityDoc('vr-arena');
  ok(actDoc && actDoc.name === 'VR Arena' && actDoc.resourceType === 'soft_capacity', 'getActivityDoc(custom) la retourne');
  ok(store.isActivityKnown('vr-arena') === true, 'isActivityKnown(vr-arena) = true');
  // Un step qui reference l'activite custom est VALIDE (pas de throw)
  let stepValid = true;
  try { await store.setFormulaSteps(pool6, { id: 'f8', steps: [{ activityId: 'vr-arena', count: 1 }] }); }
  catch (error) { stepValid = false; }
  ok(stepValid && store.getFormulaDoc('f8').steps.some((s) => s.activityId === 'vr-arena'), 'un step qui reference l\'activite custom est valide et apparait dans getFormulaDoc');
  // Un step qui reference une activite INCONNUE sans resourceType est REFUSE
  let stepRefused = false;
  try { await store.setFormulaSteps(pool6, { id: 'f8', steps: [{ activityId: 'nexiste-pas', count: 1 }] }); }
  catch (error) { stepRefused = error.expose === true; }
  ok(stepRefused, 'un step vers une activite inconnue SANS resourceType est refuse (borne de validation)');
  // updateActivity + deleteActivity (soft)
  await store.updateActivity(pool6, { id: 'vr-arena', name: 'VR Arena Pro' });
  ok(store.getActivityDoc('vr-arena').name === 'VR Arena Pro', 'updateActivity : nom reflete');
  await store.deleteActivity(pool6, { id: 'vr-arena' });
  ok(store.getActivityDoc('vr-arena') === null, 'deleteActivity (soft) : getActivityDoc(vr-arena) = null');

  // =========================================================================
  console.log('\n[CP] Contre-preuves par MUTATION (edition inverse, jamais git)');
  // =========================================================================
  async function withMutation(filePath, anchor, replacement, setup, probe, label) {
    const original = fs.readFileSync(filePath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`catalog-crud-check: ancre de mutation introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    const reload = () => {
      delete require.cache[require.resolve(filePath)];
      return require(filePath);
    };
    setup(); // prepare l'etat du store (singleton partage)
    fs.writeFileSync(filePath, mutated);
    let holds = true;
    try {
      holds = probe(reload());
    } finally {
      fs.writeFileSync(filePath, original); // restauration par EDITION INVERSE
      delete require.cache[require.resolve(filePath)];
    }
    if (holds) {
      console.error(`catalog-crud-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    setup();
    const restored = reload();
    ok(probe(restored), `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  // CP1 : neutralise le fix no-resurrect (ops-knowledge). Etat : f5 desactivee.
  // Invariant teste : getFormula(f5) === null. Mutation -> resurrection -> rouge.
  const disabledF5 = seedState();
  disabledF5.formulas = disabledF5.formulas.map((row) => (row.id === 'f5' ? { ...row, active: false } : row));
  await withMutation(
    opsKnowledgePath,
    'if (catalogStore.isFormulaKnown(formulaId)) return null;',
    'if (catalogStore.isFormulaKnown(formulaId) && false) return null;',
    () => { store.applyCatalogState(disabledF5); },
    (mod) => mod.getFormula('f5') === null,
    'fix no-resurrect neutralise (ops-knowledge.getFormula)',
  );

  // CP2 : neutralise la lecture store dans reservationNeedsLanes (booking-config).
  // Etat : f2 avec un step bowling. Invariant : reservationNeedsLanes(f2) === true.
  const f2WithBowling = seedState();
  f2WithBowling.steps.push({ formula_id: 'f2', position: 9, activity_id: 'bowling', count: 1, duration_minutes: 60, label: null, critical: true, resource_type: null });
  await withMutation(
    bookingConfigPath,
    'const formule = catalogBookingFormule(formuleId); // hasBowling derive des steps du store',
    'const formule = FORMULES.find((item) => item.id === formuleId); // hasBowling derive des steps du store',
    () => { store.applyCatalogState(f2WithBowling); },
    (mod) => mod.reservationNeedsLanes('formule', 'f2') === true,
    'lecture store dans reservationNeedsLanes neutralisee (booking-config)',
  );

  // Le socle non mute survit : reload propre + doctrine.
  delete require.cache[require.resolve(bookingConfigPath)];
  delete require.cache[require.resolve(opsKnowledgePath)];
  await loadFromSeed();
  ok(availabilityIdentityHolds(), 'apres toutes les mutations/restaurations : le store rend encore le catalogue fichier');

  store.applyCatalogState({});
  bc.setFormuleOverrides(new Map());

  if (failures) {
    console.error(`\ncatalog-crud-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ncatalog-crud-check: ALL OK (CRUD borne ; doctrine preservee ; no-resurrect prouve ; hasBowling recable ; mutations savent rougir)');
})().catch((error) => {
  console.error('catalog-crud-check: exception', error);
  process.exit(1);
});
