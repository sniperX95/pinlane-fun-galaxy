// Gate du warehouse quotidien + boucle data de l'agent marketing.
// SANS réseau ni DB : ne teste que les fonctions PURES de lib/center-metrics.js
// (calendrier BE/FWB, agrégation métriques, faits contrôlés jour-de-semaine,
// génération d'idées, mesure avant/après). node scripts/daily-metrics-check.js
const {
  easterSunday,
  isPublicHolidayBE,
  isSchoolHolidayFWB,
  nextSchoolHolidayFWB,
  computeMetricsFromReservations,
  computeFactsFromRows,
  deriveIdeaCandidates,
  makeIdeaSignature,
  computeInsightMeasurement,
} = require('../lib/center-metrics');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// ── [CAL] calendrier belge ────────────────────────────────────────────────────
console.log('[CAL] Pâques / fériés BE / congés FWB');
ok(easterSunday(2025) === '2025-04-20', `Pâques 2025 = 20 avril (obtenu ${easterSunday(2025)})`);
ok(easterSunday(2026) === '2026-04-05', `Pâques 2026 = 5 avril (obtenu ${easterSunday(2026)})`);
ok(isPublicHolidayBE('2026-04-06').holiday, 'lundi de Pâques 2026 (06/04) férié');
ok(isPublicHolidayBE('2026-05-14').holiday, 'Ascension 2026 (14/05) férié');
ok(isPublicHolidayBE('2026-05-25').holiday, 'lundi de Pentecôte 2026 (25/05) férié');
ok(isPublicHolidayBE('2026-07-21').holiday, 'Fête nationale (21/07) férié');
ok(!isPublicHolidayBE('2026-07-20').holiday, '20/07 pas férié');
ok(isSchoolHolidayFWB('2026-07-15').holiday, '15/07/2026 = été FWB');
ok(isSchoolHolidayFWB('2025-10-25').holiday, '25/10/2025 = Toussaint FWB');
ok(isSchoolHolidayFWB('2026-04-30').holiday, '30/04/2026 = printemps FWB');
ok(!isSchoolHolidayFWB('2026-03-10').holiday, '10/03/2026 = période scolaire');
ok(!isSchoolHolidayFWB('2026-05-11').holiday, '11/05/2026 = après le printemps FWB');
const nextHol = nextSchoolHolidayFWB('2026-06-20');
ok(nextHol && nextHol.from === '2026-07-03', `prochain congé après le 20/06/2026 = été 03/07 (obtenu ${nextHol?.from})`);

// ── [METRICS] agrégation d'une journée ───────────────────────────────────────
console.log('\n[METRICS] computeMetricsFromReservations');
const dayRows = [
  { status: 'paid', type: 'formule', formuleId: 'f4', pax: 12, price: 468, phone: '+32470000001', email: 'a@x.be' },
  { status: 'confirmed', type: 'bowling', pax: 6, price: 120, phone: '+32470000002', email: 'b@x.be' },
  { status: 'cancelled', type: 'laser', pax: 8, price: 200, phone: '+32470000003', email: 'c@x.be' },
];
const firstByClient = new Map([['+32470000001', '2026-07-10'], ['+32470000002', '2026-01-05']]);
const metrics = computeMetricsFromReservations(dayRows, firstByClient, '2026-07-10');
ok(metrics.visitors === 18, `visiteurs = 18 (actifs seulement, obtenu ${metrics.visitors})`);
ok(metrics.revenueTotal === 588, `CA = 588 (obtenu ${metrics.revenueTotal})`);
ok(metrics.cancellationsCount === 1, 'annulations = 1');
ok(metrics.revenueByType.formule === 468 && metrics.revenueByType.bowling === 120, 'CA par type correct');
ok(metrics.paxByType.formule === 12, 'pax par type correct');
ok(metrics.newClientsCount === 1, `nouveaux clients = 1 (première résa ce jour, obtenu ${metrics.newClientsCount})`);
ok(metrics.avgBasket === 294, `panier moyen = 294 (obtenu ${metrics.avgBasket})`);

// ── [FACTS] faits contrôlés jour-de-semaine ──────────────────────────────────
console.log('\n[FACTS] computeFactsFromRows');
// Dataset synthétique 26 semaines : samedi fort (100), mardi faible (20),
// 1 samedi sur 2 pluvieux (>=10mm) avec +20 % de visiteurs.
const BASE_BY_DOW = { 0: 60, 1: 25, 2: 20, 3: 50, 4: 22, 5: 55, 6: 100 };
function buildRows(startDate, weeks, { rainSaturdays = true } = {}) {
  const rows = [];
  const start = new Date(`${startDate}T12:00:00Z`);
  for (let day = 0; day < weeks * 7; day += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + day);
    const iso = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay();
    const saturdayIndex = dow === 6 ? Math.floor(day / 7) : -1;
    const rainy = rainSaturdays && dow === 6 && saturdayIndex % 2 === 0;
    const visitors = rainy ? Math.round(BASE_BY_DOW[dow] * 1.2) : BASE_BY_DOW[dow];
    rows.push({
      date: iso,
      visitors,
      revenue_total: visitors * 20,
      weather_tmax: rainy ? 15 : 18,
      weather_precip_mm: rainy ? 12 : 0,
      is_school_holiday: false,
    });
  }
  return rows;
}
const bigDataset = buildRows('2026-01-05', 26); // lundi 05/01/2026, 182 jours
const bigFacts = computeFactsFromRows(bigDataset);
ok(bigFacts.dataDays === 182, `182 jours de données (obtenu ${bigFacts.dataDays})`);
ok(!bigFacts.facts.some((fact) => fact.id === 'data_age'), 'pas d\'avertissement jeunesse à 182 jours');
const best = bigFacts.facts.find((fact) => fact.id === 'dow_best');
const worst = bigFacts.facts.find((fact) => fact.id === 'dow_worst');
ok(best && best.dow === 6, `meilleur jour = samedi (obtenu dow=${best?.dow})`);
ok(worst && worst.dow === 2, `pire jour = mardi (obtenu dow=${worst?.dow})`);
const rain = bigFacts.facts.find((fact) => fact.id === 'rain_effect');
ok(rain && rain.value === 20, `effet pluie contrôlé jour-de-semaine = +20 % (obtenu ${rain?.value})`);
ok(rain && rain.confidence === 'solide', `confiance solide (n=${rain?.sampleSize})`);

const youngDataset = buildRows('2026-05-04', 8); // 56 jours < 90
const youngFacts = computeFactsFromRows(youngDataset);
ok(youngFacts.facts.some((fact) => fact.id === 'data_age'), 'avertissement « données jeunes » présent à 56 jours');
ok(youngFacts.facts.every((fact) => fact.confidence === 'exploratoire'), 'tous les faits exploratoires < 90 jours');

// n < 4 par case : 2 samedis pluvieux seulement → pas de fait pluie.
const fewRain = buildRows('2026-01-05', 26, { rainSaturdays: false });
fewRain[5].weather_precip_mm = 14; // 2 jours de pluie isolés
fewRain[12].weather_precip_mm = 11;
const fewRainFacts = computeFactsFromRows(fewRain);
ok(!fewRainFacts.facts.some((fact) => fact.id === 'rain_effect'), 'pas de fait pluie sous n=4 (honnêteté)');

// ── [IDEAS] déclencheurs → idées ─────────────────────────────────────────────
console.log('\n[IDEAS] deriveIdeaCandidates');
const rainIdea = deriveIdeaCandidates({
  today: '2026-07-10',
  forecast: [{ date: '2026-07-12', tmax: 18, precipMm: 15 }],
});
ok(rainIdea.length === 1 && rainIdea[0].trigger === 'rain_forecast', 'pluie J+2 → idée plan pluie');
// Lifecycle (refonte 17/07) : une idée datée porte son jour visé DANS la
// signature (le dédupe 7 j ne bloque plus les jours suivants) ET en
// targetDate (la péremption la tue à la fin de son jour).
ok(rainIdea[0].targetDate === '2026-07-12', 'l\'idée pluie porte son jour visé (targetDate)');
ok(rainIdea[0].signature === makeIdeaSignature('rain_forecast', 'facebook', '2026-07-12'), 'signature = trigger:channel:jour visé');
ok(rainIdea[0].signature !== makeIdeaSignature('rain_forecast', 'facebook', '2026-07-19'),
  'une pluie un autre jour = une autre signature (le dédupe ne bloque plus la semaine)');
ok(rainIdea[0].readyContent.includes('15 mm'), 'contenu prêt cite la prévision exacte');

const heatIdea = deriveIdeaCandidates({
  today: '2026-07-10',
  forecast: [{ date: '2026-07-13', tmax: 27, precipMm: 0 }],
});
ok(heatIdea.length === 1 && heatIdea[0].trigger === 'heat_forecast', 'chaleur ≥25° J+3 → idée plan fraîcheur');
ok(heatIdea[0].readyContent.includes('27°'), 'contenu cite la température prévue');

const holidayIdea = deriveIdeaCandidates({
  today: '2026-06-25',
  nextHoliday: { from: '2026-07-03', to: '2026-08-23', label: "Vacances d'été 2026" },
});
ok(holidayIdea.length === 1 && holidayIdea[0].trigger === 'school_holiday', 'congé FWB à ≤14 j → idée vacances');

const eventIdea = deriveIdeaCandidates({
  today: '2026-07-15',
  localEvents: [{ from: '2026-07-24', to: '2026-07-27', label: 'Foire de Libramont' }],
});
ok(eventIdea.length === 1 && eventIdea[0].trigger === 'local_event', 'Foire de Libramont à ≤14 j → idée dédiée');
ok(eventIdea[0].targetDate === '2026-07-27', 'l\'idée événement meurt à la FIN de l\'événement');
ok(holidayIdea[0].targetDate === '2026-07-03', 'l\'idée congé meurt au DÉBUT du congé (après, « ça commence le X » est périmé)');

const quietTuesday = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [{ id: 'dow_worst', dow: 2, value: 20, sampleSize: 26, label: 'Le mardi est ton jour le plus calme : 20 visiteurs en moyenne (sur 26 mardis).' }],
});
ok(quietTuesday.length === 1 && quietTuesday[0].trigger === 'quiet_day', 'mardi creux → idée offre creuse');
const quietWednesday = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [{ id: 'dow_worst', dow: 3, value: 30, sampleSize: 26, label: 'x' }],
});
ok(quietWednesday.length === 0, 'mercredi creux → PAS d\'idée (jour des enfants en Belgique)');

const allTriggers = deriveIdeaCandidates({
  today: '2026-07-15',
  forecast: [{ date: '2026-07-17', tmax: 27, precipMm: 12 }],
  nextHoliday: { from: '2026-07-20', to: '2026-08-23', label: 'Été' },
  localEvents: [{ from: '2026-07-24', to: '2026-07-27', label: 'Foire de Libramont' }],
  facts: [{ id: 'dow_worst', dow: 4, value: 18, sampleSize: 20, label: 'x' }],
});
ok(allTriggers.length === 3, `cap à 3 idées max (obtenu ${allTriggers.length})`);

// ── [MEASURE] avant/après contrôlé ───────────────────────────────────────────
console.log('\n[MEASURE] computeInsightMeasurement');
function measureRows(dates, visitors) {
  return dates.map((date, index) => ({ date, visitors: visitors[index], revenue_total: visitors[index] * 20, is_school_holiday: false }));
}
// 4 mardis + 4 samedis avant, idem après avec +20 %.
const beforeDates = ['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28'];
const afterDates = ['2026-04-07', '2026-04-14', '2026-04-21', '2026-04-28', '2026-04-04', '2026-04-11', '2026-04-18', '2026-04-25'];
const up = computeInsightMeasurement({
  before: measureRows(beforeDates, [20, 20, 20, 20, 100, 100, 100, 100]),
  after: measureRows(afterDates, [24, 24, 24, 24, 120, 120, 120, 120]),
});
ok(up.verdict === 'validated' && up.deltaPct === 20, `+20 % → validated (obtenu ${up.verdict} ${up.deltaPct}%)`);
const down = computeInsightMeasurement({
  before: measureRows(beforeDates, [20, 20, 20, 20, 100, 100, 100, 100]),
  after: measureRows(afterDates, [16, 16, 16, 16, 80, 80, 80, 80]),
});
ok(down.verdict === 'refuted' && down.deltaPct === -20, `-20 % → refuted (obtenu ${down.verdict})`);
const tiny = computeInsightMeasurement({
  before: measureRows(['2026-03-03'], [20]),
  after: measureRows(['2026-04-07'], [40]),
});
ok(tiny.verdict === 'inconclusive', `n<4 jours comparables → inconclusive (obtenu ${tiny.verdict})`);
const flat = computeInsightMeasurement({
  before: measureRows(beforeDates, [20, 20, 20, 20, 100, 100, 100, 100]),
  after: measureRows(afterDates, [21, 21, 21, 21, 103, 103, 103, 103]),
});
ok(flat.verdict === 'inconclusive', `bruit ±10 % → inconclusive (obtenu ${flat.verdict} ${flat.deltaPct}%)`);

if (failures) { console.error(`\ndaily-metrics-check: ${failures} FAIL`); process.exit(1); }
console.log('\ndaily-metrics-check: ALL OK');
