// Gate de CORRECTION DU PRIX : prouve que les overrides catalogue appliques en
// memoire (lib/booking-config) changent le prix FACTURE et la liste servie, et
// que SANS override le comportement est STRICTEMENT identique au fichier (aucun
// centime de derive). C'est de la logique argent : le gate mute puis restaure.
'use strict';
const assert = require('assert');
const bc = require('../lib/booking-config');

let pass = 0;
const checks = [];
function ok(name, cond, detail) {
  checks.push({ name, ok: !!cond });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' :: ' + detail : ''}`);
  if (cond) pass += 1;
}

// Une formule per_pax du socle (on lit la vraie liste pour ne pas coder en dur).
const baseFormule = bc.FORMULES.find((f) => f.type !== 'per_lane');
assert(baseFormule, 'aucune formule per_pax dans le socle');
const FID = baseFormule.id;
const BASE_PRICE = baseFormule.price;

console.log('\n[A] Sans override : comportement identique au fichier');
bc.setFormuleOverrides(new Map());
ok('getBasePrice formule sans override = prix fichier x pax',
  bc.getBasePrice('formule', 0, 0, 10, FID) === BASE_PRICE * 10,
  `${bc.getBasePrice('formule', 0, 0, 10, FID)} vs ${BASE_PRICE * 10}`);
const effBase = bc.getEffectiveFormules('libramont');
ok('getEffectiveFormules sans override = meme nombre de formules', effBase.length === bc.FORMULES.length, `${effBase.length}/${bc.FORMULES.length}`);
ok('getEffectiveFormules sans override = memes prix', effBase.every((f, i) => f.price === bc.FORMULES[i].price && f.id === bc.FORMULES[i].id), 'deep-equal prix/id');

console.log('\n[B] Override de prix GLOBAL (all) : prix facture et servi changent');
bc.setFormuleOverrides(new Map([[`${FID}|all`, { formuleId: FID, centerId: 'all', name: null, priceValue: 99, priceOld: null, enabled: null, removed: false }]]));
ok('getBasePrice reflete le prix override (99 x pax)', bc.getBasePrice('formule', 0, 0, 10, FID) === 99 * 10, String(bc.getBasePrice('formule', 0, 0, 10, FID)));
ok('getEffectiveFormules sert le prix override', (bc.getEffectiveFormules('libramont').find((f) => f.id === FID) || {}).price === 99);
ok('une AUTRE formule reste au prix fichier', bc.getBasePrice('formule', 0, 0, 10, bc.FORMULES.find((f) => f.id !== FID && f.type !== 'per_lane').id) !== 99 * 10);

console.log('\n[C] Precedence centre > all sur le prix');
bc.setFormuleOverrides(new Map([
  [`${FID}|all`, { formuleId: FID, centerId: 'all', name: null, priceValue: 99, priceOld: null, enabled: null, removed: false }],
  [`${FID}|gembloux`, { formuleId: FID, centerId: 'gembloux', name: null, priceValue: 50, priceOld: null, enabled: null, removed: false }],
]));
ok('gembloux facture le prix centre (50)', bc.getBasePrice('formule', 0, 0, 10, FID, 'gembloux') === 50 * 10, String(bc.getBasePrice('formule', 0, 0, 10, FID, 'gembloux')));
ok('libramont (sans ligne centre) facture le prix all (99)', bc.getBasePrice('formule', 0, 0, 10, FID, 'libramont') === 99 * 10, String(bc.getBasePrice('formule', 0, 0, 10, FID, 'libramont')));

console.log('\n[D] Retrait (removed) : formule exclue de la liste servie');
bc.setFormuleOverrides(new Map([[`${FID}|all`, { formuleId: FID, centerId: 'all', name: null, priceValue: null, priceOld: null, enabled: null, removed: true }]]));
ok('formule retiree absente de getEffectiveFormules', !bc.getEffectiveFormules('libramont').some((f) => f.id === FID));
ok('les autres formules restent servies', bc.getEffectiveFormules('libramont').length === bc.FORMULES.length - 1);

console.log('\n[E] Restauration : map videe = comportement fichier');
bc.setFormuleOverrides(new Map());
ok('apres reset, prix = fichier', bc.getBasePrice('formule', 0, 0, 10, FID) === BASE_PRICE * 10);
ok('apres reset, liste complete', bc.getEffectiveFormules('libramont').length === bc.FORMULES.length);

const failed = checks.filter((c) => !c.ok);
console.log(`\nbooking-overrides-check: ${pass}/${checks.length} verts.`);
if (failed.length) { console.error(`booking-overrides-check: ECHEC (${failed.length} rouge(s)).`); process.exit(1); }
console.log('booking-overrides-check: ALL OK (prix facture et liste servie refletent les overrides ; sans override, identique au fichier)');
process.exit(0);
