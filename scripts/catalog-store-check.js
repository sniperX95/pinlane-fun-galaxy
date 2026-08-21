// Gate du CATALOGUE UNIFIE (lib/catalog-store.js, migration 0038, backfill
// scripts/backfill-catalog.js). PROUVE LA DOCTRINE, pas la presence de chaines :
//
//   1. DB VIDE : getFormulaDoc / getBookingFormule / getActivityDoc rendent
//      EXACTEMENT ce que le systeme servait avant le refactor, c.-a-d. le contenu
//      des fichiers socle (deep-equal sur les 14 formules + 11 activites).
//   2. BACKFILL SEED simule (lignes DB = contenu des fichiers, rejouees via
//      buildSeedRows du backfill) : getBasePrice IDENTIQUE au centime,
//      getFormuleAvailability IDENTIQUE (memes verdicts), getFormulaDoc == fichier
//      (deep-equal, steps compris), et getFormulaAnchorModel(store) ==
//      getFormulaAnchorModel(fichier) pour les formules a ancres.
//   3. Les formule_overrides (catalog-overrides) s'appliquent TOUJOURS PAR-DESSUS
//      le catalogue DB (un override de prix donne le meme prix qu'avant).
//   4. custom / active : une ligne source='custom' apparait ; active=false
//      disparait ; SANS backfill (DB vide), RIEN ne change.
//   + Chemin DB reel (pool mock qui obeit au SQL) + fail-soft (base qui jette =
//      dernier etat conserve).
//   + 2 contre-preuves par MUTATION du code (edition inverse, jamais git) :
//      casser la conversion timeLimit heures<->minutes fait rougir l'identite de
//      getFormuleAvailability ; casser la derivation hasBowling depuis les steps
//      fait rougir l'identite deep-equal de getBookingFormule.
//
// Lancement : node scripts/catalog-store-check.js

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const storePath = path.join(ROOT, 'lib', 'catalog-store.js');

let failures = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
  return cond;
}

function deepEq(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch (error) { return false; }
}

// Le socle : les VRAIS fichiers. Les assertions "identique au fichier" se
// mesurent contre eux, jamais contre une copie inventee.
const FORMULES = require(path.join(ROOT, 'lib', 'booking-config')).FORMULES;
const DOC_FORMULAS = require(path.join(ROOT, 'ops-knowledge', 'formulas.json')).formulas;
const ACTIVITIES = require(path.join(ROOT, 'ops-knowledge', 'activities.json')).activities;
const bookingById = new Map(FORMULES.map((formule) => [formule.id, formule]));
const docById = new Map(DOC_FORMULAS.map((doc) => [doc.id, doc]));

const store = require(path.join(ROOT, 'lib', 'catalog-store'));
const bc = require(path.join(ROOT, 'lib', 'booking-config'));
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
    seed,
    state: {
      formulas: seed.formulas.map(pgFormulaRow),
      steps: seed.steps.slice(),
      activities: seed.activities.slice(),
    },
  };
}

// ── Faux pool pg : obeit au texte SQL, peut simuler une panne (fail-soft) ─────
let poolRows = { formulas: [], steps: [], activities: [] };
let poolThrows = false;
class FakePool {
  async query(text) {
    if (poolThrows) throw new Error('DB indisponible (simulee)');
    const sql = String(text);
    if (/from formula_steps/i.test(sql)) return { rows: poolRows.steps.slice(), rowCount: poolRows.steps.length };
    if (/from formulas/i.test(sql)) return { rows: poolRows.formulas.slice(), rowCount: poolRows.formulas.length };
    if (/from activities/i.test(sql)) return { rows: poolRows.activities.slice(), rowCount: poolRows.activities.length };
    return { rows: [], rowCount: 0 };
  }
}
const pool = new FakePool();

// ── Sondes reutilisees par les sections vertes ET les contre-preuves ─────────
// Grille de dates/heures (couvre chaque jour de la semaine + un jour ferie) et
// de tailles de groupe, pour comparer les verdicts de dispo formule par formule.
const PROBE_DATES = [
  '2026-09-14', // lundi
  '2026-09-15', // mardi
  '2026-09-16', // mercredi
  '2026-09-17', // jeudi
  '2026-09-18', // vendredi
  '2026-09-19', // samedi
  '2026-09-20', // dimanche
  '2026-07-21', // fete nationale (jour ferie belge)
];
const PROBE_TIMES = ['09:00', '11:00', '13:00', '17:00', '18:00', '20:00', '21:00'];
const PROBE_PAX = [1, 6, 10];

// Identite de getFormuleAvailability : pour chaque formule, chaque date/heure/pax,
// le verdict rendu sur la formule DU STORE doit egaler celui rendu sur la formule
// DU FICHIER. Retourne true si tout concorde.
function availabilityIdentityHolds(storeModule) {
  for (const fileFormule of FORMULES) {
    const storeFormule = storeModule.getBookingFormule(fileFormule.id);
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

// Identite deep-equal de getBookingFormule vs le fichier (hasBowling / bowlingDur
// compris). Retourne true si les 14 concordent.
function bookingIdentityHolds(storeModule) {
  for (const fileFormule of FORMULES) {
    if (!deepEq(storeModule.getBookingFormule(fileFormule.id), fileFormule)) return false;
  }
  return true;
}

// Prix attendu depuis le FICHIER (source de verite d'avant le refactor).
function expectedBasePrice(fileFormule, pax, laneCount) {
  return fileFormule.type === 'per_lane' ? fileFormule.price * laneCount : fileFormule.price * pax;
}

(async () => {
  bc.setFormuleOverrides(new Map());

  // =========================================================================
  console.log('[1] DB VIDE : le store rend EXACTEMENT le contenu des fichiers');
  // =========================================================================
  store.applyCatalogState({});
  let docFail = 0;
  for (const rawDoc of DOC_FORMULAS) {
    if (!deepEq(store.getFormulaDoc(rawDoc.id), rawDoc)) { docFail += 1; console.log(`    doc mismatch: ${rawDoc.id}`); }
  }
  ok(docFail === 0, `getFormulaDoc == ops-knowledge/formulas.json pour les ${DOC_FORMULAS.length} formules (deep-equal, steps compris)`);
  let bookFail = 0;
  for (const rawFormule of FORMULES) {
    if (!deepEq(store.getBookingFormule(rawFormule.id), rawFormule)) { bookFail += 1; console.log(`    booking mismatch: ${rawFormule.id}`); }
  }
  ok(bookFail === 0, `getBookingFormule == booking-config FORMULES pour les ${FORMULES.length} formules (deep-equal)`);
  let actFail = 0;
  for (const rawActivity of ACTIVITIES) {
    if (!deepEq(store.getActivityDoc(rawActivity.id), rawActivity)) { actFail += 1; console.log(`    activity mismatch: ${rawActivity.id}`); }
  }
  ok(actFail === 0, `getActivityDoc == ops-knowledge/activities.json pour les ${ACTIVITIES.length} activites (deep-equal)`);
  ok(store.listBookingFormules().length === FORMULES.length
    && store.listBookingFormules().every((f, i) => f.id === FORMULES[i].id),
  'listBookingFormules : meme nombre et MEME ORDRE que le fichier');

  // =========================================================================
  console.log('\n[2] BACKFILL SEED (lignes DB = fichiers, via buildSeedRows) : comportement IDENTIQUE');
  // =========================================================================
  const { seed, state } = seedState();
  ok(seed.divergences.length === 0, `reconciliation sans divergence (${seed.divergences.length})`);
  store.applyCatalogState(state);

  // 2a. getFormulaDoc identique au fichier (steps compris)
  docFail = 0;
  for (const rawDoc of DOC_FORMULAS) {
    if (!deepEq(store.getFormulaDoc(rawDoc.id), rawDoc)) { docFail += 1; console.log(`    doc mismatch seed: ${rawDoc.id}`); }
  }
  ok(docFail === 0, 'getFormulaDoc(seed) == fichier pour les 14 formules (deep-equal, steps compris)');

  // 2b. getBasePrice identique au centime (empty ET seed == fichier)
  let priceFail = 0;
  for (const fileFormule of FORMULES) {
    for (const pax of PROBE_PAX) {
      for (const laneCount of [1, 2, 3]) {
        const expected = expectedBasePrice(fileFormule, pax, laneCount);
        const actual = bc.getBasePrice('formule', 0, laneCount, pax, fileFormule.id);
        if (actual !== expected) { priceFail += 1; console.log(`    price mismatch ${fileFormule.id} pax=${pax} lanes=${laneCount}: ${actual} != ${expected}`); }
      }
    }
  }
  ok(priceFail === 0, 'getBasePrice(seed) == prix fichier au centime (per_pax et per_lane, pax et lanes varies)');

  // 2c. getFormuleAvailability identique (grille complete)
  ok(availabilityIdentityHolds(store), 'getFormuleAvailability(seed) == verdicts fichier (grille dates/heures/pax complete)');

  // 2d. getBookingFormule identique au fichier (bonus deep-equal)
  ok(bookingIdentityHolds(store), 'getBookingFormule(seed) == fichier (deep-equal, hasBowling/bowlingDur derives)');

  // 2e. modele d'ancrage identique (bowling/laser)
  let anchorFail = 0;
  const anchored = [];
  for (const rawDoc of DOC_FORMULAS) {
    const model = getFormulaAnchorModel(store.getFormulaDoc(rawDoc.id));
    const fileModel = getFormulaAnchorModel(rawDoc);
    if (model.anchors.length) anchored.push(rawDoc.id);
    if (!deepEq(model, fileModel)) { anchorFail += 1; console.log(`    anchor mismatch: ${rawDoc.id}`); }
  }
  ok(anchorFail === 0, `getFormulaAnchorModel(getFormulaDoc) == fichier (14 formules ; a ancres: ${anchored.join(',')})`);

  // =========================================================================
  console.log('\n[3] Les formule_overrides s appliquent TOUJOURS PAR-DESSUS le catalogue DB');
  // =========================================================================
  const perPax = FORMULES.find((f) => f.type !== 'per_lane');
  bc.setFormuleOverrides(new Map([
    [`${perPax.id}|all`, { formuleId: perPax.id, centerId: 'all', name: null, priceValue: 99, priceOld: null, enabled: null, removed: false }],
  ]));
  ok(bc.getBasePrice('formule', 0, 0, 10, perPax.id) === 99 * 10,
    `override de prix (99) applique par-dessus le catalogue DB : getBasePrice = 990 (obtenu ${bc.getBasePrice('formule', 0, 0, 10, perPax.id)})`);
  bc.setFormuleOverrides(new Map([
    [`${perPax.id}|all`, { formuleId: perPax.id, centerId: 'all', name: null, priceValue: null, priceOld: null, enabled: null, removed: true }],
  ]));
  ok(!bc.getEffectiveFormules('libramont').some((f) => f.id === perPax.id),
    'override removed : la formule disparait de getEffectiveFormules (catalogue DB + overrides composes)');
  bc.setFormuleOverrides(new Map());

  // =========================================================================
  console.log('\n[4] custom / active : ajout, retrait, et SANS backfill rien ne change');
  // =========================================================================
  const customState = {
    formulas: [
      ...state.formulas,
      pgFormulaRow({
        id: 'zztest', name: 'FORMULE TEST', family: 'Speciale', min_pax: 3,
        price_type: 'per_pax', price_value: 42, price_old: null, not_during_holidays: false,
        valid_days: [5], time_limit_min_minutes: null, time_limit_max_minutes: null,
        human_validation: 'recommended', order_policy: 'flexible', is_birthday_formula: false,
        best: false, description_lines: ['Activite test'], sort_index: 99, source: 'custom', active: true,
      }),
    ],
    steps: [
      ...state.steps,
      { formula_id: 'zztest', position: 0, activity_id: 'bowling', count: 1, duration_minutes: 60, label: null, critical: true, resource_type: null },
    ],
    activities: state.activities.slice(),
  };
  store.applyCatalogState(customState);
  const customDoc = store.getFormulaDoc('zztest');
  const customBooking = store.getBookingFormule('zztest');
  ok(customDoc && customDoc.name === 'FORMULE TEST' && customDoc.steps.length === 1 && customDoc.steps[0].activityId === 'bowling',
    'source=custom : la formule zztest apparait dans getFormulaDoc avec ses steps');
  ok(customBooking && customBooking.price === 42 && customBooking.type === 'per_pax' && customBooking.hasBowling === true && customBooking.bowlingDur === 1,
    'source=custom : getBookingFormule expose prix/type et hasBowling derive des steps');
  ok(store.listBookingFormules().some((f) => f.id === 'zztest'),
    'source=custom : zztest listee dans listBookingFormules');

  // active=false : disparait
  const disabledState = {
    formulas: state.formulas.map((row) => (row.id === perPax.id ? { ...row, active: false } : row)),
    steps: state.steps.slice(),
    activities: state.activities.slice(),
  };
  store.applyCatalogState(disabledState);
  ok(store.getFormulaDoc(perPax.id) === null && store.getBookingFormule(perPax.id) === null
    && !store.listBookingFormules().some((f) => f.id === perPax.id),
  `active=false : ${perPax.id} disparait de getFormulaDoc / getBookingFormule / listBookingFormules`);

  // SANS backfill (DB vide) : rien ne change
  store.applyCatalogState({});
  ok(store.getBookingFormule(perPax.id) && !store.getBookingFormule('zztest')
    && store.listBookingFormules().length === FORMULES.length,
  'SANS backfill (DB vide) : catalogue = fichier (perPax present, zztest absent, 14 formules)');

  // =========================================================================
  console.log('\n[5] Chemin DB reel (pool mock) + fail-soft (base qui jette)');
  // =========================================================================
  poolRows = state;
  poolThrows = false;
  await store.refreshCatalog(pool, { force: true });
  ok(deepEq(store.getFormulaDoc('f1'), docById.get('f1')),
    'refreshCatalog(pool) charge les 3 tables via SQL et rend le catalogue (f1 == fichier)');
  // La base tombe : refreshCatalog garde le DERNIER etat connu (le seed charge).
  poolThrows = true;
  const refreshed = await store.refreshCatalog(pool, { force: true });
  ok(refreshed === false && deepEq(store.getFormulaDoc('f1'), docById.get('f1')),
    'fail-soft : base qui jette => refreshCatalog=false et le dernier etat (seed) est conserve');
  poolThrows = false;
  store.applyCatalogState({});

  // =========================================================================
  console.log('\n[6] Contre-preuves par MUTATION (edition inverse, jamais git checkout)');
  // =========================================================================
  async function withMutation(anchor, replacement, probe, seedFresh, label) {
    const original = fs.readFileSync(storePath, 'utf8');
    const occurrences = original.split(anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`catalog-store-check: ancre de mutation introuvable ou ambigue (${occurrences}) : ${label}`);
      process.exit(1);
    }
    const mutated = original.replace(anchor, replacement);
    if (mutated === original) {
      console.error(`catalog-store-check: la mutation n'a rien change : ${label}`);
      process.exit(1);
    }
    const freshLoad = () => {
      delete require.cache[require.resolve(storePath)];
      const mod = require(storePath);
      if (seedFresh) mod.applyCatalogState(seedState().state);
      return mod;
    };
    fs.writeFileSync(storePath, mutated);
    let holds = true;
    try {
      holds = probe(freshLoad());
    } finally {
      fs.writeFileSync(storePath, original); // restauration par EDITION INVERSE
      delete require.cache[require.resolve(storePath)];
    }
    if (holds) {
      console.error(`catalog-store-check: MUTATION SANS EFFET, le gate ne sait pas rougir : ${label}`);
      process.exit(1);
    }
    ok(true, `mutation "${label}" : l'invariant est viole, le gate ROUGIRAIT`);
    const restored = freshLoad();
    ok(seedFresh ? availabilityIdentityHolds(restored) && bookingIdentityHolds(restored) : bookingIdentityHolds(restored),
      `restauration inverse "${label}" : l'invariant tient de nouveau`);
  }

  // Casse la conversion timeLimit minutes -> heures : la formule mm (fin a 12h,
  // duree 2h) ne serait plus bloquee a 11h -> l'identite de getFormuleAvailability rougit.
  await withMutation(
    'if (canonical.timeLimitMax != null) formule.timeLimit.max = canonical.timeLimitMax / 60;',
    'if (canonical.timeLimitMax != null) formule.timeLimit.max = canonical.timeLimitMax;',
    (mod) => availabilityIdentityHolds(mod),
    true,
    'conversion timeLimit heures<->minutes cassee',
  );

  // Casse la derivation hasBowling depuis les steps : hasBowling toujours faux ->
  // l'identite deep-equal de getBookingFormule rougit (f1, f3, f4, bts, css, ffm).
  await withMutation(
    "const bowling = canonical.steps.find((step) => step.activityId === 'bowling');",
    "const bowling = canonical.steps.find((step) => step.activityId === 'bowling_mutation');",
    (mod) => bookingIdentityHolds(mod),
    false,
    'derivation hasBowling depuis les steps cassee',
  );

  // =====================================================================
  // LA CATEGORIE SAISIE FAIT FOI JUSQU A L ECRAN (2026-08-22)
  // =====================================================================
  // Movsar veut creer ses propres categories (« une nouvelle grosse categorie
  // avec des ajouts de formules dedans »). La colonne formulas.family existe,
  // est libre et deja patchable : ce qui manquait, c est que
  // buildCanonicalFormula l IGNORAIT pour le libelle booking, celui que lisent
  // la console ET le tunnel. Mesure en base le 2026-08-22 : N4 portait deja
  // « Bowling », « Groupes » et « Promotions », invisibles a l ecran.
  //
  // Non-regression aussi importante : les libelles historiques (« Anniversaire »,
  // « Speciale ») doivent s afficher comme aujourd hui, sinon l ecran de Fun
  // Galaxy change sans que personne l ait demande.
  {
    delete require.cache[require.resolve(storePath)];
    const store = require(storePath);
    const row = (id, name, family, birthday) => ({
      id, name, family, min_pax: 6, price_type: 'per_pax', price_value: 20, price_old: null,
      not_during_holidays: false, valid_days: null, time_limit_min_minutes: null,
      time_limit_max_minutes: null, human_validation: null, order_policy: null,
      is_birthday_formula: birthday, best: false, description_lines: null,
      sort_index: null, source: 'custom', active: true, owner_client_id: 'all',
    });
    store.applyCatalogState({
      formulas: [
        row('cat-soiree', 'Soiree entreprise', 'Soirees entreprises', false),
        row('cat-histo', 'Formule historique', 'Anniversaire', true),
        row('cat-histo2', 'Autre historique', 'Speciale', false),
        row('cat-vide', 'Sans categorie', '', false),
      ],
      steps: [], activities: [], centerClients: [],
    });
    const famille = (id) => {
      const f = store.getBookingFormule(id, 'libramont');
      return f ? f.family : null;
    };
    ok(famille('cat-soiree') === 'Soirees entreprises',
      `une categorie CREEE arrive telle quelle jusqu au format booking (obtenu ${JSON.stringify(famille('cat-soiree'))})`);
    ok(famille('cat-histo') === 'Formules anniversaires',
      `le libelle historique « Anniversaire » s affiche comme avant (obtenu ${JSON.stringify(famille('cat-histo'))})`);
    ok(famille('cat-histo2') === 'Formules speciales',
      `le libelle historique « Speciale » s affiche comme avant (obtenu ${JSON.stringify(famille('cat-histo2'))})`);
    ok(famille('cat-vide') === 'Formules speciales',
      `sans categorie saisie, le repli ne bouge pas (obtenu ${JSON.stringify(famille('cat-vide'))})`);
  }

  // Le socle non mute survit a tout : reload propre puis identite.
  delete require.cache[require.resolve(storePath)];
  const clean = require(storePath);
  clean.applyCatalogState({});
  ok(bookingIdentityHolds(clean) && availabilityIdentityHolds(clean),
    'apres toutes les mutations et restaurations : le store rend encore le catalogue fichier');

  if (failures) {
    console.error(`\ncatalog-store-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\ncatalog-store-check: ALL OK (DB vide = fichier ; seed = comportement identique ; overrides composes ; mutations savent rougir)');
})().catch((error) => {
  console.error('catalog-store-check: exception', error);
  process.exit(1);
});
