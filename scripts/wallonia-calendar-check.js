// LE CALENDRIER WALLON SUIT L ANNEE EN COURS, SANS QU ON RETAPE LA TABLE.
//
// Les horaires d un centre changent les feries et les conges scolaires
// (defaultSchedule.holiday). Les feries legaux se CALCULENT pour n importe
// quelle annee (Paques par l algorithme de Meeus). Les conges scolaires de la
// Federation Wallonie-Bruxelles, eux, sont publies chaque annee : la table
// WALLONIA_SCHOOL_HOLIDAYS est la reserve, et le serveur relit le calendrier
// officiel republie par OpenHolidays (groupe BE-FR), 24 h par instance,
// fail-soft. Ce gate prouve chaque maillon sans reseau.
//
// LES PROPRIETES :
//   [A] la reserve voit au moins six mois devant : sinon `npm run sync:calendar`
//       (le message le dit), pour que la table ne s eteigne jamais en silence ;
//   [B] le parseur ne garde que le groupe BE-FR (les calendriers flamand et
//       germanophone sont dans la meme reponse), ignore les marqueurs d un jour,
//       ramene les libelles aux cinq noms de la table ;
//   [C] les periodes lues S AJOUTENT a la table, elles n en retirent rien ;
//   [D] la relecture est fail-soft : un site tiers qui jette ou qui repond
//       autre chose laisse la table faire foi, un succes est garde 24 h ;
//   [E] les feries se calculent pour une annee que la table ne connait pas ;
//   [F] les horaires de vacances s appliquent au centre reel : un lundi de
//       conge d automne ouvre 10h-22h a Libramont, un lundi ordinaire est ferme,
//       Noel (un vendredi de vacances) ouvre 10h-minuit ;
//   [G] le calendrier servi au formulaire (calendar=N) porte, jour par jour,
//       l ouverture, les horaires et la periode ; `calendarFrom` le fait partir
//       d un autre jour (le calendrier par mois du formulaire), n accepte qu un
//       VRAI jour et jamais avant aujourd hui.
//
// Usage : node scripts/wallonia-calendar-check.js
'use strict';
process.env.PINLANE_CALENDAR_SYNC = 'off';
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/booking-config');
const { getCenter } = require('../lib/ops-knowledge');
const meta = require('../api/public-booking-meta.js');

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
function plusJours(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

(async () => {
  const today = cfg.todayStr();

  console.log('[A] LA RESERVE VOIT DEVANT');
  const couverture = cfg.walloniaSchoolHolidayCoverage();
  ok(couverture >= plusJours(today, 180), '[A] la table statique couvre au moins six mois', `${couverture} (aujourd hui ${today}) ; sinon : npm run sync:calendar`);

  console.log('');
  console.log('[B] LE PARSEUR');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'openholidays-be-school-2026.json'), 'utf8'));
  const parsed = cfg.parseOpenHolidaysSchoolEntries(fixture);
  const cle = (r) => `${r.start}>${r.end} ${r.label} ${r.kind}`;
  const attendu = [
    "2026-07-04>2026-08-23 Vacances d'ete summer",
    "2026-10-19>2026-11-01 Conge d'automne short",
    "2026-12-21>2027-01-03 Vacances d'hiver short",
    '2027-02-22>2027-03-07 Conge de detente short',
    '2027-04-26>2027-05-09 Vacances de printemps short',
  ];
  ok(parsed.map(cle).join(' | ') === attendu.join(' | '), '[B] cinq periodes BE-FR, libelles canoniques, dans l ordre', parsed.map(cle).join(' | '));
  ok(!parsed.some((r) => r.start === '2027-02-08'), '[B] le carnaval flamand (BE-NL) n entre pas');
  ok(!parsed.some((r) => r.start === '2027-07-03' && r.end === '2027-07-03'), '[B] le marqueur d un jour « Debut des vacances d ete » n entre pas');
  ok(cfg.parseOpenHolidaysSchoolEntries(null).length === 0 && cfg.parseOpenHolidaysSchoolEntries([{ groups: [{ code: 'BE-FR' }], startDate: 'n importe quoi', endDate: '2027-01-01' }]).length === 0, '[B] une reponse vide ou mal formee rend une liste vide, jamais une erreur');
  ok(parsed.every((r) => cfg.WALLONIA_SCHOOL_HOLIDAYS.some((s) => s.start === r.start && s.end === r.end && s.label === r.label)), '[B] chaque periode lue pour 2026-2027 est deja dans la table, mot pour mot');

  console.log('');
  console.log('[C] LECTURE = AJOUT, JAMAIS RETRAIT');
  cfg.__setWalloniaFetchedForTests([{ start: '2031-10-20', end: '2031-11-02', label: "Conge d'automne", kind: 'short' }]);
  ok(Boolean(cfg.getHolidayContext('2031-10-25').schoolHoliday), '[C] une periode lue est connue');
  ok(Boolean(cfg.getHolidayContext('2026-10-19').schoolHoliday), '[C] la table statique reste connue a cote');
  cfg.__setWalloniaFetchedForTests([]);
  ok(!cfg.getHolidayContext('2031-10-25').schoolHoliday, '[C] sans lecture, la date lue n est plus connue (les gates repartent propres)');

  console.log('');
  console.log('[D] RELECTURE FAIL-SOFT');
  delete process.env.PINLANE_CALENDAR_SYNC;
  const synthetique = fixture.concat([{ startDate: '2031-10-20', endDate: '2031-11-02', type: 'School', name: [{ language: 'FR', text: "Congé d'automne (Toussaint)" }], groups: [{ code: 'BE-FR', shortName: 'FR' }] }]);
  const bonne = async () => ({ ok: true, status: 200, json: async () => synthetique });
  const r1 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: bonne, now: 1000 });
  ok(r1.ok && !r1.cached && r1.count === 6, '[D] une lecture reussie garde ses periodes', JSON.stringify(r1));
  ok(Boolean(cfg.getHolidayContext('2031-10-25').schoolHoliday), '[D] et la date lue est connue');
  const r2 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: async () => { throw new Error('ne doit pas etre appele'); }, now: 1000 + 3600 * 1000 });
  ok(r2.ok && r2.cached, '[D] dans les 24 h, aucun nouvel appel reseau', JSON.stringify(r2));
  const r3 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: async () => { throw new Error('panne'); }, now: 1000 + 25 * 3600 * 1000 });
  ok(!r3.ok && r3.reason === 'panne' && Boolean(cfg.getHolidayContext('2031-10-25').schoolHoliday), '[D] une panne du site tiers ne retire rien', JSON.stringify(r3));
  const r4 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ groups: [{ code: 'BE-NL' }], startDate: '2031-01-01', endDate: '2031-01-10', name: [{ language: 'FR', text: 'x' }] }] }), now: 1000 + 27 * 3600 * 1000 });
  ok(!r4.ok && /aucune periode/.test(r4.reason) && Boolean(cfg.getHolidayContext('2031-10-25').schoolHoliday), '[D] une reponse sans periode BE-FR ne remplace pas la precedente', JSON.stringify(r4));
  const r5 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => [] }), now: 1000 + 29 * 3600 * 1000 });
  ok(!r5.ok && /HTTP 503/.test(r5.reason), '[D] un statut HTTP d erreur est un echec nomme', JSON.stringify(r5));
  const lent = (signalPris) => (url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => synthetique }), 400);
    if (options && options.signal) options.signal.addEventListener('abort', () => { clearTimeout(timer); signalPris.abandonne = true; reject(new Error('abandonne')); });
  });
  const trace = { abandonne: false };
  const r6 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: lent(trace), timeoutMs: 60, now: 1000 + 31 * 3600 * 1000 });
  ok(!r6.ok && trace.abandonne, '[D] un site trop lent est abandonne au delai borne', JSON.stringify(r6));
  process.env.PINLANE_CALENDAR_SYNC = 'off';
  const r7 = await cfg.refreshWalloniaSchoolHolidays({ fetchImpl: async () => { throw new Error('ne doit pas etre appele'); }, now: 1000 + 60 * 3600 * 1000 });
  ok(!r7.ok && r7.reason === 'desactive', '[D] PINLANE_CALENDAR_SYNC=off coupe tout appel reseau');
  cfg.__setWalloniaFetchedForTests([]);

  console.log('');
  console.log('[E] LES FERIES SE CALCULENT');
  ok(cfg.getHolidayContext('2027-03-29').publicHoliday === 'Lundi de Paques', '[E] lundi de Paques 2027 = 29 mars', cfg.getHolidayContext('2027-03-29').publicHoliday || 'rien');
  ok(cfg.getHolidayContext('2030-04-22').publicHoliday === 'Lundi de Paques', '[E] lundi de Paques 2030 = 22 avril', cfg.getHolidayContext('2030-04-22').publicHoliday || 'rien');
  ok(cfg.getHolidayContext('2027-05-06').publicHoliday === 'Ascension', '[E] Ascension 2027 = 6 mai');
  ok(cfg.getHolidayContext('2033-11-01').publicHoliday === 'Toussaint' && cfg.getHolidayContext('2033-07-21').publicHoliday === 'Fete nationale', '[E] feries fixes connus en 2033');
  ok(cfg.getHolidayContext('2026-12-25').periodType === 'public', '[E] Noel prime sur les vacances d hiver (periode « public »)');

  console.log('');
  console.log('[F] LES HORAIRES DE VACANCES DU CENTRE REEL');
  const libramont = getCenter('libramont');
  const lundiConge = cfg.getSchedule('2026-10-19', libramont);
  const lundiOrdinaire = cfg.getSchedule('2026-10-12', libramont);
  const noel = cfg.getSchedule('2026-12-25', libramont);
  ok(lundiConge && lundiConge.open === 10 && lundiConge.close === 22, '[F] lundi 19 octobre 2026 (conge d automne) : ouvert 10h-22h', JSON.stringify(lundiConge));
  ok(lundiOrdinaire === null, '[F] lundi 12 octobre 2026 (ordinaire) : ferme', JSON.stringify(lundiOrdinaire));
  ok(noel && noel.open === 10 && noel.close === 24, '[F] vendredi 25 decembre 2026 (Noel) : ouvert 10h-minuit', JSON.stringify(noel));

  console.log('');
  console.log('[G] LE CALENDRIER SERVI AU FORMULAIRE');
  const calendrier = meta.__test.buildCalendar([], 90, libramont, 'libramont');
  ok(calendrier.length === 90 && calendrier[0].date === today, '[G] 90 jours a partir d aujourd hui', `${calendrier.length}, premier ${calendrier[0] && calendrier[0].date}`);
  const lundis = calendrier.filter((j) => j.weekday === 1);
  // Aujourd hui, passe la fermeture, se dit « Fermé pour aujourd’hui » (over) :
  // un lundi de conge joue le soir rougissait le gate (2026-10-19, 23:30).
  ok(lundis.length >= 12 && lundis.every((j) => (j.over ? j.date === today && !j.open : j.holiday ? j.open && j.schedule && j.schedule.open === 10 : !j.open && j.closedLabel === 'Fermé ce jour')), '[G] chaque lundi : ferme, sauf en periode speciale ou il ouvre a 10h (le jour meme, fini le soir)', `${lundis.length} lundis`);
  const automne = calendrier.filter((j) => j.date >= '2026-10-19' && j.date <= '2026-11-01');
  ok(automne.length === 0 || automne.every((j) => j.holiday && /automne|Toussaint/.test(j.holiday.label)), '[G] les jours du conge d automne portent leur periode', automne.length ? `${automne.length} jours, ${automne[0].holiday && automne[0].holiday.label}` : 'hors fenetre');
  ok(calendrier.every((j) => typeof j.open === 'boolean' && (j.schedule === null || (typeof j.schedule.open === 'number' && typeof j.schedule.label === 'string'))), '[G] chaque jour porte ouverture et horaires');
  const { calendarFromParam } = meta.__test;
  const essais = { '2027-03-01': '2027-03-01', '2028-02-29': '2028-02-29', '2027-02-29': '', '2027-02-31': '', '2027-13-01': '', '1999-12-31': '', '2100-01-01': '', '2027-3-1': '', 'abc': '', '': '' };
  const rates = Object.entries(essais).filter(([brut, attendu]) => calendarFromParam(brut) !== attendu);
  ok(rates.length === 0 && calendarFromParam(null) === '', '[G] calendarFrom n accepte qu un VRAI jour entre 2000 et 2099 (le 31 fevrier et le 29 fevrier 2027 sont refuses)', rates.map(([b]) => b).join(', ') || `${Object.keys(essais).length} cas`);
  const [ay, am] = today.split('-').map(Number);
  const dansSixMois = new Date(Date.UTC(ay, am - 1 + 6, 1)).toISOString().slice(0, 10);
  const mois = meta.__test.buildCalendar([], 31, libramont, 'libramont', dansSixMois);
  const suite = mois.every((j, i) => j.date === new Date(Date.UTC(ay, am - 1 + 6, 1 + i)).toISOString().slice(0, 10));
  ok(mois.length === 31 && mois[0].date === dansSixMois && suite, '[G] calendarFrom sert 31 jours d affilee a partir du jour demande (six mois plus loin)', `${mois[0] && mois[0].date} a ${mois[30] && mois[30].date}`);
  ok(mois.every((j) => j.open === (cfg.getSchedule(j.date, libramont) !== null)), '[G] ces jours-la, l ouverture servie est celle des horaires du centre (feries et conges compris)');
  const passe = meta.__test.buildCalendar([], 3, libramont, 'libramont', '2020-01-01');
  ok(passe[0] && passe[0].date === today, '[G] un calendarFrom passe repart d aujourd hui', passe[0] && passe[0].date);

  console.log('');
  if (failures) { console.error(`wallonia-calendar-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('wallonia-calendar-check: ALL OK');
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
