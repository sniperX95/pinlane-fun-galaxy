// Gate NODE (sans navigateur) de buildClientCatalog (lib/catalog-overrides.js).
// Prouve, sur du VRAI code, les deux garanties portees par la vue editeur
// tarifaire CLIENT :
//   1. SECURITE : buildClientCatalog REFUSE centerId='all' et centerId vide
//      (throw expose), AVANT toute lecture utile. Meme classe de faille que
//      l'escalade de role : un centre ne lit/edite jamais le tarif partage.
//   2. ISOLATION + FUSION : un override scope centreA n'apparait PAS dans le
//      clientCatalog de centreB ; effective = base <- override 'all' <- override
//      du centre (le centre prime champ par champ) ; centerOverride ne reflete
//      QUE l'override propre au centre (ni le socle, ni 'all').
//
// Plus une CONTRE-PREUVE par MUTATION (le gate sait rougir) : neutraliser la
// garde 'all' (assertClientCenterId) fait passer 'all' -> la securite rougit ;
// restauration par EDITION INVERSE exacte (jamais git checkout).
//
// Zero reseau, zero base : on passe un faux pool a buildClientCatalog (le seul
// query() emis est le SELECT de loadFormuleOverrides, auquel on repond en memoire).
// Lancement : node scripts/client-catalog-check.js
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const catalogPath = path.join(ROOT, 'lib', 'catalog-overrides.js');

let failures = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures += 1;
  return cond;
}

function freshCatalog() {
  delete require.cache[require.resolve(catalogPath)];
  return require(catalogPath);
}

// Lignes d'override en memoire, forme colonne SQL exacte (loadFormuleOverrides
// lit formule_id/center_id/name/price_value/price_old/enabled/removed/sort_index).
function row(formuleId, centerId, patch = {}) {
  return {
    formule_id: formuleId,
    center_id: centerId,
    name: patch.name === undefined ? null : patch.name,
    price_value: patch.priceValue === undefined ? null : patch.priceValue,
    price_old: patch.priceOld === undefined ? null : patch.priceOld,
    enabled: patch.enabled === undefined ? null : patch.enabled,
    removed: patch.removed === undefined ? false : patch.removed,
    sort_index: null,
  };
}

// Faux pool : le seul SELECT emis par buildClientCatalog est celui de
// loadFormuleOverrides. On enregistre les appels pour prouver "aucune lecture"
// sur un refus de securite.
function makePool(rows) {
  const calls = [];
  return {
    calls,
    async query(text) {
      calls.push(String(text));
      if (/from formule_overrides/i.test(String(text))) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

const CENTER = 'gembloux'; // porteur d'un override de centre
const OTHER = 'libramont'; // temoin (retrait scope a lui seul)

// Jeu d'overrides :
//  f1 : 'all' pose nom + prix 30 ; le centre CENTER surcharge le prix a 40.
//  f2 : le centre OTHER retire la formule (removed).
const OVERRIDES = [
  row('f1', 'all', { name: 'NOM GLOBAL', priceValue: 30 }),
  row('f1', CENTER, { priceValue: 40 }),
  row('f2', OTHER, { removed: true }),
];

(async () => {
  const lib = freshCatalog();

  // ==========================================================================
  console.log('[1] SECURITE : buildClientCatalog refuse all/vide AVANT toute lecture');
  // ==========================================================================
  for (const bad of ['all', '', '   ', null, undefined]) {
    const pool = makePool(OVERRIDES);
    let refused = false;
    try {
      await lib.buildClientCatalog(pool, bad);
    } catch (error) {
      refused = Boolean(error && error.expose);
    }
    ok(refused && pool.calls.length === 0,
      `centerId=${JSON.stringify(bad)} refuse (erreur exposee) et AUCUNE requete`,
      `refused=${refused} calls=${pool.calls.length}`);
  }

  // ==========================================================================
  console.log('\n[2] FUSION base <- all <- centre (le centre prime champ par champ)');
  // ==========================================================================
  const catCenter = await lib.buildClientCatalog(makePool(OVERRIDES), CENTER);
  const f1 = catCenter.formulas.find((f) => f.id === 'f1');
  ok(catCenter.ok && catCenter.centerId === CENTER, 'wrapper ok + centerId scope au centre', JSON.stringify({ ok: catCenter.ok, centerId: catCenter.centerId }));
  ok(f1 && f1.base && f1.base.priceValue === 26, 'f1.base.priceValue = socle (26)', JSON.stringify(f1 && f1.base));
  ok(f1 && f1.effective.priceValue === 40, 'f1.effective.priceValue = override du centre (40, prime sur all=30)', String(f1 && f1.effective.priceValue));
  ok(f1 && f1.effective.name === 'NOM GLOBAL', "f1.effective.name herite de 'all' (le centre n'a pas pose de nom)", JSON.stringify(f1 && f1.effective.name));
  ok(f1 && f1.centerOverride && f1.centerOverride.priceValue === 40 && f1.centerOverride.name === undefined,
    "f1.centerOverride ne porte QUE l'ecart du centre (priceValue), pas le nom de 'all'", JSON.stringify(f1 && f1.centerOverride));

  // Formule sans aucun override : effective == socle, centerOverride null.
  const f3 = catCenter.formulas.find((f) => f.id === 'f3');
  ok(f3 && f3.centerOverride === null && f3.effective.removed === false && f3.effective.enabled === true,
    'f3 (aucun override) : centerOverride null, enabled true, removed false', JSON.stringify(f3 && { co: f3.centerOverride, eff: f3.effective }));
  ok(f3 && f3.effective.priceValue === f3.base.priceValue, 'f3 effective == socle (aucun ecart)', JSON.stringify(f3 && { eff: f3.effective.priceValue, base: f3.base.priceValue }));

  // ==========================================================================
  console.log('\n[3] ISOLATION : le retrait/override du centreA n affecte pas le centreB');
  // ==========================================================================
  const f2centre = catCenter.formulas.find((f) => f.id === 'f2');
  ok(f2centre && f2centre.effective.removed === false && f2centre.centerOverride === null,
    'f2 vue par CENTER : NON retiree (le retrait de OTHER ne fuit pas)', JSON.stringify(f2centre && { removed: f2centre.effective.removed, co: f2centre.centerOverride }));

  const catOther = await lib.buildClientCatalog(makePool(OVERRIDES), OTHER);
  const f2other = catOther.formulas.find((f) => f.id === 'f2');
  ok(f2other && f2other.effective.removed === true && f2other.centerOverride && f2other.centerOverride.removed === true,
    'f2 vue par OTHER : retiree + centerOverride.removed=true', JSON.stringify(f2other && { removed: f2other.effective.removed, co: f2other.centerOverride }));
  const f1other = catOther.formulas.find((f) => f.id === 'f1');
  ok(f1other && f1other.effective.priceValue === 30 && f1other.centerOverride === null,
    "f1 vue par OTHER : herite du prix 'all' (30), aucun ecart propre (centerOverride null)", JSON.stringify(f1other && { price: f1other.effective.priceValue, co: f1other.centerOverride }));

  // ==========================================================================
  console.log('\n[4] CONTRE-PREUVE par MUTATION : neutraliser la garde all -> securite rougit');
  // ==========================================================================
  const original = fs.readFileSync(catalogPath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const anchor = '  if (center === DEFAULT_CENTER) {'.split('\n').join(eol);
  const mutated = '  if (false && center === DEFAULT_CENTER) {'.split('\n').join(eol);
  const occ = original.split(anchor).length - 1;
  if (occ !== 1) {
    console.error(`client-catalog-check: ancre de mutation introuvable ou ambigue (${occ})`);
    process.exit(1);
  }
  fs.writeFileSync(catalogPath, original.replace(anchor, mutated));
  let leaked = false;
  try {
    const mutLib = freshCatalog();
    const pool = makePool(OVERRIDES);
    try {
      await mutLib.buildClientCatalog(pool, 'all'); // ne devrait plus jeter
      leaked = pool.calls.length > 0; // a bien lu le catalogue pour 'all'
    } catch (error) {
      leaked = false;
    }
  } finally {
    fs.writeFileSync(catalogPath, original); // EDITION INVERSE exacte
  }
  ok(leaked, 'mutation : sans la garde, buildClientCatalog(all) NE jette plus (le gate ROUGIRAIT)');
  if (!leaked) {
    console.error('client-catalog-check: MUTATION SANS EFFET, le gate ne sait pas rougir.');
    process.exit(1);
  }
  ok(fs.readFileSync(catalogPath, 'utf8') === original, 'restauration : catalog-overrides.js identique a l original');

  // Re-verification VERTE apres restauration.
  const restored = freshCatalog();
  let refusedAgain = false;
  try {
    await restored.buildClientCatalog(makePool(OVERRIDES), 'all');
  } catch (error) {
    refusedAgain = Boolean(error && error.expose);
  }
  ok(refusedAgain, 'apres restauration : la garde all tient encore (all refuse)');

  if (failures) {
    console.error(`\nclient-catalog-check: ${failures} FAIL`);
    process.exit(1);
  }
  console.log('\nclient-catalog-check: ALL OK (all refuse, fusion base<-all<-centre, isolation, contre-preuve mutation)');
  process.exit(0);
})().catch((error) => {
  console.error('client-catalog-check: exception', error && (error.stack || error));
  process.exit(1);
});
