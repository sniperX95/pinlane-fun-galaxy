// LE JOUR DE TEST SE CHOISIT SUR LA TABLE DU CODE (2026-10-15).
//
// scripts/jour-de-test.js donne leur jour aux gates qui le choisissaient
// eux-memes. Ce gate le prouve sans horloge : `aujourdhui` est injecte, et
// chaque attendu se relit dans lib/booking-config (conge d automne 2026 du
// 19/10 au 01/11 inclus, Armistice le mercredi 11/11, Libramont ferme le
// lundi hors vacances).
//
// Usage : node scripts/jour-de-test-check.js
'use strict';
const { jourDeTest } = require('./jour-de-test');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
function choisi(options) {
  try { return jourDeTest(options); } catch (error) { return `erreur : ${error.message}`; }
}
function vaut(options, attendu, label) {
  const obtenu = choisi(options);
  ok(obtenu === attendu, label, `${obtenu} (attendu ${attendu})`);
}

vaut({ jour: 6, aujourdhui: '2026-10-17' }, '2026-11-07', 'samedi depuis le samedi 17/10 : les 24 et 31/10 (conge d automne) sautent');
vaut({ jour: 6, aujourdhui: '2026-10-15' }, '2026-10-17', 'samedi depuis le jeudi 15/10 : le 17/10, avant le conge');
vaut({ jour: 3, aujourdhui: '2026-10-15' }, '2026-11-04', 'mercredi depuis le 15/10 : les 21 et 28/10 (conge) sautent');
vaut({ jour: 3, aujourdhui: '2026-11-04' }, '2026-11-18', 'mercredi depuis le 04/11 : le 11/11 (Armistice) saute');
vaut({ jour: 5, aujourdhui: '2026-10-16' }, '2026-11-06', 'vendredi depuis le vendredi 16/10 : les 23 et 30/10 (conge) sautent');
vaut({ jour: 6, depuis: 7, aujourdhui: '2026-10-15' }, '2026-11-07', 'samedi a une semaine au moins du 15/10 : le 24/10 (conge) saute');

// CONTRE-EPREUVE : sans le filtre, le samedi du conge revient. C est bien le
// filtre qui decide, pas un samedi deja libre par hasard.
vaut({ jour: 6, horsVacances: false, aujourdhui: '2026-10-17' }, '2026-10-24', 'CONTRE-EPREUVE horsVacances false : le samedi 24/10 (conge) revient');

// La repetition depuis un autre jour : sans `aujourdhui`, la variable fait foi.
const avant = process.env.PINLANE_AUJOURDHUI_DE_TEST;
process.env.PINLANE_AUJOURDHUI_DE_TEST = '2026-10-18';
vaut({ jour: 6 }, '2026-11-07', 'PINLANE_AUJOURDHUI_DE_TEST=2026-10-18 : le samedi se choisit depuis le dimanche 18/10');
if (avant === undefined) delete process.env.PINLANE_AUJOURDHUI_DE_TEST; else process.env.PINLANE_AUJOURDHUI_DE_TEST = avant;

// Aucun jour possible : une erreur qui le dit, jamais une date fausse.
const lundi = choisi({ jour: 1, aujourdhui: '2026-10-15' });
ok(/^erreur : jour-de-test : aucun lundi /.test(lundi), 'un lundi hors vacances a Libramont (ferme ce jour-la) : une erreur claire', lundi);

console.log('');
if (failures) { console.error(`jour-de-test-check: ${failures} verification(s) en echec.`); process.exit(1); }
console.log('jour-de-test-check: ALL OK');
