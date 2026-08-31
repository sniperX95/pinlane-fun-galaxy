// UN PALIER DE TARIF NE DEPASSE JAMAIS LE PRIX DE BASE.
//
// Mesure du 2026-09-01, la nuit avant l'ouverture Fun Galaxy Libramont.
//
// La doctrine des paliers (lib/activity-pricing.js, en tete) est explicite :
// « Tant que le CRENEAU n'est pas choisi, le prix de base s'applique [...] le
// montant ne peut que BAISSER une fois l'heure connue. Un client n'est jamais
// surpris vers le haut. » Or RIEN ne comparait un palier au prix de base :
// normalizeActivityPricing({ tiers: [{ price: 25, days: [3] }] }) sur une base
// a 10 EUR etait ACCEPTE, et visit-program facturait 150 EUR le mercredi 15h
// pour un panier affiche 60 EUR avant le choix du creneau (execute, +90 EUR).
// En prod aujourd'hui, les 8 activites de Libramont ont pricing:null : le
// defaut est LATENT, ce gate le rend impossible.
//
// Le point d'application est le COUPLE effectif (base, paliers) au moment de
// l'ecriture catalogue (catalog-store), dans les DEUX sens :
//   - poser un palier au-dessus de la base (createActivity / patch pricing) ;
//   - abaisser la base sous un palier existant (patch priceValue).
//
// Proprietes :
//   A. MONTAGE : une activite custom avec un palier EN DESSOUS de la base se
//      cree et se lit. Prouve que le gate mesure.
//   B. Un palier au-dessus de la base est REFUSE a la creation.
//   C. Abaisser la base sous un palier existant est REFUSE au patch.
//   D. Non-regression : relever la base passe, retirer les paliers passe,
//      une base non chiffree (regle sur place) ne compare rien.
//
// Contre-epreuve par mutation : on neutralise la garde a chacun des deux
// points d'application, le gate doit rougir, restauration a l'identique.
//
// Lancement : node scripts/pricing-tier-ceiling-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, 'lib', 'catalog-store.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

// Pool minimal qui OBEIT aux requetes du store : selects de chargement servis
// depuis le socle reel, table activities STATEFUL (l'upsert est parse par sa
// liste de colonnes, donc insensible aux drapeaux de migration).
function poolLite(seed) {
  const state = { activities: seed.activities.map((row) => ({ ...row })) };
  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (/^select/i.test(sql)) {
      if (/from formulas/i.test(sql)) return { rows: seed.formulas };
      if (/from formula_steps/i.test(sql)) return { rows: seed.steps };
      if (/from centers/i.test(sql)) return { rows: [] };
      if (/from activities/i.test(sql)) {
        if (/where/i.test(sql)) {
          const rows = state.activities.filter((row) => row.id === params[0]
            && (params[1] === undefined || String(row.center_id) === String(params[1])));
          return { rows };
        }
        return { rows: state.activities };
      }
      return { rows: [] };
    }
    if (/^insert into activities/i.test(sql)) {
      const cols = (sql.match(/insert into activities \(([^)]+)\)/i) || [])[1];
      if (!cols) throw new Error(`upsert activities illisible : ${sql.slice(0, 80)}`);
      const row = {};
      cols.split(',').map((col) => col.trim()).forEach((col, index) => { row[col] = params[index]; });
      if (typeof row.pricing === 'string') row.pricing = JSON.parse(row.pricing);
      const key = (r) => `${r.id}|${r.center_id}|${r.owner_client_id || ''}`;
      const index = state.activities.findIndex((r) => key(r) === key(row));
      if (index === -1) state.activities.push(row); else state.activities[index] = { ...state.activities[index], ...row };
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
  return { query, connect: async () => ({ query, release() {} }) };
}

async function attend(promise, motif) {
  try { await promise; return { ok: true, message: '' }; }
  catch (error) { return { ok: false, message: error && error.message || '' }; }
}

async function main() {
  const store = require(STORE);
  const { buildSeedRows } = require(path.join(ROOT, 'scripts', 'backfill-catalog.js'));
  const pool = poolLite(buildSeedRows());
  const base = {
    centerId: 'all', resourceType: 'free', priceType: 'per_pax', priceUnit: 'par personne',
  };

  // --- A. MONTAGE : palier sous la base, accepte ----------------------------
  const doux = await attend(store.createActivity(pool, {
    ...base, id: 'qa-tarif-doux', name: 'QA Tarif Doux', priceValue: 10,
    pricing: { mode: 'per_person', tiers: [{ price: 8, days: [3] }] },
  }));
  ok(doux.ok, `montage : un palier SOUS la base se cree (${doux.message || 'accepte'})`);
  ok(Boolean(store.getActivityDoc('qa-tarif-doux')), 'montage : l activite custom se lit dans le store');

  // --- B. Palier au-dessus de la base : refuse a la creation ----------------
  const fou = await attend(store.createActivity(pool, {
    ...base, id: 'qa-tarif-fou', name: 'QA Tarif Fou', priceValue: 10,
    pricing: { mode: 'per_person', tiers: [{ price: 25, days: [3] }] },
  }));
  ok(!fou.ok && /depasse le prix de base/.test(fou.message),
    `un palier au-dessus de la base est refuse a la creation (${fou.message || 'ACCEPTE, 60 EUR affiches deviendraient 150'})`);

  // --- C. Abaisser la base sous un palier existant : refuse -----------------
  const abaisse = await attend(store.updateActivity(pool, { id: 'qa-tarif-doux', centerId: 'all', priceValue: 5 }));
  ok(!abaisse.ok && /depasse le prix de base/.test(abaisse.message),
    `abaisser la base sous un palier existant est refuse (${abaisse.message || 'ACCEPTE en silence'})`);

  // --- D. Non-regression ----------------------------------------------------
  const releve = await attend(store.updateActivity(pool, { id: 'qa-tarif-doux', centerId: 'all', priceValue: 12 }));
  ok(releve.ok, `relever la base passe (${releve.message || 'accepte'})`);
  const sansPaliers = await attend(store.updateActivity(pool, { id: 'qa-tarif-doux', centerId: 'all', pricing: null, priceValue: 5 }));
  ok(sansPaliers.ok, `retirer les paliers puis abaisser la base passe (${sansPaliers.message || 'accepte'})`);
  const surPlace = await attend(store.createActivity(pool, {
    ...base, id: 'qa-tarif-libre', name: 'QA Tarif Libre', priceValue: null,
    pricing: { mode: 'per_person', tiers: [{ price: 25, days: [3] }] },
  }));
  ok(surPlace.ok, `une base non chiffree (regle sur place) ne compare rien (${surPlace.message || 'accepte'})`);

  if (failures) {
    console.error(`\npricing-tier-ceiling-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\npricing-tier-ceiling-check: ALL OK (le prix annonce avant le creneau ne peut que baisser)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(STORE, 'utf8');
  const { spawnSync } = require('child_process');
  let rate = 0;
  const MUTATIONS = [
    ['garde neutralisee a la creation',
      'assertPricingUnderBase(fields.pricing, fields.price_value);',
      'void fields.pricing;'],
    ['garde neutralisee au patch',
      'assertPricingUnderBase(row.pricing, row.price_value);',
      'void row.pricing;'],
  ];
  for (const [nom, marqueur, remplacement] of MUTATIONS) {
    if (!source.includes(marqueur)) {
      console.error(`mutation impossible (${nom}) : marqueur introuvable dans lib/catalog-store.js`);
      process.exit(1);
    }
    fs.writeFileSync(STORE, source.replace(marqueur, remplacement));
    const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
    fs.writeFileSync(STORE, source);
    if (run.status === 0) { console.error(`CONTRE-EPREUVE RATEE (${nom}) : le gate reste vert.`); rate += 1; }
    else console.log(`contre-epreuve OK : ${nom} fait rougir le gate.`);
  }
  process.exit(rate ? 1 : 0);
}

main().catch((error) => { console.error('pricing-tier-ceiling-check: exception', error); process.exit(1); });
