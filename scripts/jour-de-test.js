// LE JOUR DE TEST D UN GATE (2026-10-15).
//
// Les gates qui choisissaient leur jour eux-memes (« le prochain samedi ») ou
// l ecrivaient en dur tombaient dans le conge d automne, sur un ferie ou dans
// le passe : la formule « hors vacances » refusee, « Cette date est déjà
// passée. », et le gate rougissait pour une raison de calendrier. Le jour se
// choisit ici, sur la table du code (lib/booking-config : conges scolaires,
// feries, horaires du centre). Pur : aucune ecriture, aucun reseau.
//
// PINLANE_AUJOURDHUI_DE_TEST=AAAA-MM-JJ rejoue le choix depuis un autre jour
// (la repetition du dimanche : PINLANE_AUJOURDHUI_DE_TEST=2026-10-18) ; sans
// elle, aujourd hui au fuseau du centre.
//
// Garde : node scripts/jour-de-test-check.js
'use strict';
const bookingConfig = require('../lib/booking-config');
const { getCenter } = require('../lib/ops-knowledge');

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Un jour AAAA-MM-JJ decale de n jours (en UTC : aucun changement d heure).
function plusJours(jour, n) {
  const [y, m, d] = String(jour).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Le premier `jour` de la semaine (0 = dimanche) a au moins `depuis` jours
// d `aujourdhui` ou le centre ouvre ; horsVacances : ni conge scolaire, ni
// ferie, ni formule « hors vacances » bloquee ce jour-la. todayStr se lit a
// l appel : un gate qui fige l horloge du moteur choisit sur la meme.
function jourDeTest({ jour = 6, depuis = 1, centre = 'libramont', horsVacances = true, aujourdhui = process.env.PINLANE_AUJOURDHUI_DE_TEST || bookingConfig.todayStr() } = {}) {
  const fiche = getCenter(centre);
  for (let k = depuis; k < depuis + 400; k += 1) {
    const date = plusJours(aujourdhui, k);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() !== jour || !bookingConfig.getSchedule(date, fiche)) continue;
    if (horsVacances && (bookingConfig.isHolidayScheduleDate(date, fiche) || bookingConfig.isFormulaBlockedDate(date, fiche))) continue;
    return date;
  }
  throw new Error(`jour-de-test : aucun ${JOURS[jour]} ou ${centre} ouvre${horsVacances ? ', hors vacances et feries,' : ''} dans les 400 jours a partir du ${plusJours(aujourdhui, depuis)}.`);
}

module.exports = { jourDeTest, plusJours };
