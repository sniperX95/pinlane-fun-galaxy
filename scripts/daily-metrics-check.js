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
  polishIdeaWithAi,
} = require('../lib/center-metrics');
const { WALLONIA_SCHOOL_HOLIDAYS } = require('../lib/booking-config');

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
// La date exacte n'est PAS ré-encodée ici. Elle vivait en double dans
// lib/booking-config (moteur de réservation) et lib/center-metrics (métriques),
// avec deux jours d'écart sur l'été 2026 : 04/07 contre 03/07 (mesuré le
// 2026-08-22). Les métriques dérivent désormais de booking-config, seule source
// d'autorité ; ce test vérifie donc le COMPORTEMENT (le prochain congé trouvé
// après le 20/06/2026 est bien l'été 2026, aux dates de la source) au lieu de
// devenir un troisième exemplaire qui divergera à son tour.
const expectedSummer = WALLONIA_SCHOOL_HOLIDAYS.find(period => period.kind === 'summer' && period.start > '2026-06-20');
ok(!!expectedSummer, 'la source d\'autorité connaît un été après le 20/06/2026');
ok(nextHol && expectedSummer && nextHol.from === expectedSummer.start, `prochain congé après le 20/06/2026 = été ${expectedSummer && expectedSummer.start} (obtenu ${nextHol?.from})`);
ok(nextHol && /été|ete/i.test(String(nextHol.label || '')), `le congé trouvé est bien l'été (obtenu ${nextHol?.label})`);

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
  forecast: [{ date: '2026-07-13', tmax: 29, precipMm: 0 }],
});
ok(heatIdea.length === 1 && heatIdea[0].trigger === 'heat_forecast', 'vraie chaleur J+3 → idée plan fraîcheur');
ok(heatIdea[0].readyContent.includes('29°'), 'contenu cite la température prévue');


// UNE IDEE « PLAN FRAICHEUR » EXIGE UNE VRAIE CHALEUR, ET LA RARETE SE CALCULE.
// Releve en production le 2026-09-04 : trois posts « plan fraicheur » proposes
// pour 26 degres, avec « rare par ici » ecrit EN DUR dans les deux branches du
// gabarit. En Belgique en septembre, 26 degres n est ni rare ni une chaleur :
// personne ne fuit vers l interieur, et le gerant lit une betise. Les seuils
// STATISTIQUES (23 et 25) ne bougent pas, ils servent a mesurer un effet sur la
// frequentation ; c est le seuil de l IDEE qui monte. Et une affirmation sur le
// climat d un lieu se calcule sur les releves de ce lieu, ou ne se dit pas.
const chaleurTiede = deriveIdeaCandidates({
  today: '2026-09-04',
  forecast: [{ date: '2026-09-07', tmax: 26, precipMm: 0 }],
});
ok(chaleurTiede.length === 0, "26° un 7 septembre : AUCUNE idée plan fraîcheur (ce n'est pas une chaleur)");

const histoireChaude = Array.from({ length: 60 }, (_, i) => ({ weather_tmax: 30 - (i % 3) }));
const sansRarete = deriveIdeaCandidates({
  today: '2026-07-10',
  forecast: [{ date: '2026-07-13', tmax: 29, precipMm: 0 }],
  weatherHistory: histoireChaude,
});
ok(sansRarete.length === 1 && !/rare/i.test(String(sansRarete[0].why) + String(sansRarete[0].readyContent)),
  'chez un centre où 29° est banal, le mot rare n apparaît nulle part');

const histoireFroide = Array.from({ length: 60 }, (_, i) => ({ weather_tmax: i < 3 ? 30 : 14 }));
const avecRarete = deriveIdeaCandidates({
  today: '2026-07-10',
  forecast: [{ date: '2026-07-13', tmax: 29, precipMm: 0 }],
  weatherHistory: histoireFroide,
});
ok(avecRarete.length === 1 && /5\s*%/.test(String(avecRarete[0].why)),
  'chez un centre où 29° est exceptionnel, la rareté est CHIFFRÉE (5 % des jours)');

const sansHistorique = deriveIdeaCandidates({
  today: '2026-07-10',
  forecast: [{ date: '2026-07-13', tmax: 29, precipMm: 0 }],
});
ok(sansHistorique.length === 1 && !/rare/i.test(String(sansHistorique[0].why) + String(sansHistorique[0].readyContent)),
  'sans historique météo, aucune affirmation de rareté n est faite');

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

// UN « JOUR LE PLUS CALME » N EXISTE QUE S IL Y A UNE ACTIVITE A COMPARER.
// Releve en production le 2026-09-03 sur Gembloux : « Le mardi est ton jour le
// plus calme : 0 visiteurs en moyenne (sur 6 mardis) », avec une campagne email
// redigee dessus. L echantillon passait le filtre, mais le centre n avait AUCUNE
// reservation dans l outil : l agent lisait une base vide comme un fait
// commercial. Le garde-fou porte donc sur le MEILLEUR jour, pas sur le pire.
const jourActif = { id: 'dow_best', dow: 6, value: 48, sampleSize: 26, label: 'x' };
const quietTuesday = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [jourActif, { id: 'dow_worst', dow: 2, value: 20, sampleSize: 26, label: 'Le mardi est ton jour le plus calme : 20 visiteurs en moyenne (sur 26 mardis).' }],
});
ok(quietTuesday.length === 1 && quietTuesday[0].trigger === 'quiet_day', 'mardi creux → idée offre creuse');
const quietWednesday = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [jourActif, { id: 'dow_worst', dow: 3, value: 30, sampleSize: 26, label: 'x' }],
});
ok(quietWednesday.length === 0, 'mercredi creux → PAS d\'idée (jour des enfants en Belgique)');

const baseVide = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [
    { id: 'dow_best', dow: 6, value: 1, sampleSize: 26, label: 'x' },
    { id: 'dow_worst', dow: 2, value: 0, sampleSize: 6, label: 'Le mardi est ton jour le plus calme : 0 visiteurs en moyenne (sur 6 mardis).' },
  ],
});
ok(baseVide.length === 0, "un centre SANS activité réelle ne produit aucun constat de creux (0 visiteur n'est pas un fait)");

const creuxSansMeilleurJour = deriveIdeaCandidates({
  today: '2026-03-10',
  facts: [{ id: 'dow_worst', dow: 2, value: 20, sampleSize: 26, label: 'x' }],
});
ok(creuxSansMeilleurJour.length === 0, 'sans point de comparaison (aucun dow_best), aucun constat de creux');

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

(async () => {
// UNE REECRITURE IA N INVENTE PAS UN LIEU.
// Releve en production le 2026-09-04 : le post de LIBRAMONT portait « #Namur ».
// Libramont est en province de Luxembourg, Namur est celle de Gembloux. La
// cause n est pas le modele : la consigne Facebook lui demande « 0 a 2 hashtags
// en fin, du type nom du lieu et ville », et la ville ne lui etait JAMAIS
// donnee, donc il la devinait. On comble le trou (la ville entre dans les
// faits) ET on ferme la porte (le controle d ancrage ne regardait que les
// CHIFFRES : un lieu, une enseigne ou une promo inventes passaient librement).
console.log('\n[ANCRAGE] la reecriture IA n invente pas un lieu');
  const envSauve = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'cle-de-mesure';
  const repondre = (texte) => async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ content: texte }) }] }),
  });
  const candidat = {
    trigger: 'heat_forecast', channel: 'facebook', tmax: 29, dayLabel: 'lundi 07/09',
    readyContent: '29° annoncés lundi 07/09 : chez nous il fait frais toute la journée. Bowling, laser game, arcades.',
    why: '29 °C annoncés lundi 07/09.',
    dataBasis: [{ source: 'weather_daily_forecast', date: '2026-09-07', tmax: 29 }],
  };
  const facts = { centerName: 'Libramont', city: 'Libramont' };
  const attendu = '29° annoncés lundi 07/09 : chez nous il fait frais. #Libramont';
  const propre = await polishIdeaWithAi(candidat, { fetchImpl: repondre(attendu), centerFacts: facts });
  ok(propre === attendu, 'MONTAGE : un hashtag qui est la VILLE du centre est accepté (sinon le refus ne prouverait rien)');
  const invente = await polishIdeaWithAi(candidat, { fetchImpl: repondre('29° annoncés lundi 07/09 : chez nous il fait frais. #Namur'), centerFacts: facts });
  ok(invente === null, 'un hashtag de lieu ABSENT des faits (#Namur sur Libramont) est refusé');
  const enseigne = await polishIdeaWithAi(candidat, { fetchImpl: repondre('29° annoncés lundi 07/09 : venez au SuperFunPark, il fait frais.'), centerFacts: facts });
  ok(enseigne === null, 'un nom propre inventé dans le corps (une enseigne qui n existe pas) est refusé');
  const chiffre = await polishIdeaWithAi(candidat, { fetchImpl: repondre('29° annoncés lundi 07/09 : 12 € la partie, il fait frais.'), centerFacts: facts });
  ok(chiffre === null, 'un prix inventé reste refusé (le garde-fou des nombres tient toujours)');
  if (envSauve === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = envSauve;


  // ── UNE FENETRE VIDE N EST PAS UN VERDICT ───────────────────────────────
  // measureAppliedInsights ecrivait `measured_at = now()` meme quand aucune
  // ligne de daily_center_metrics ne couvrait la fenetre. La requete du haut
  // filtre sur `measured_at is null` : l idee etait close pour toujours, et
  // aggregateMarketingPatterns comme le bandit d angles apprenaient d une
  // mesure qui n avait pas eu lieu. C est l etat d une base remise a zero.
  console.log('\n[REPORT] une fenetre sans donnee ne conclut rien');

  // MONTAGE : le calcul pur est deja honnete sur une fenetre vide. Ce n est
  // donc pas lui qu on corrige, c est ce qu on FAIT de sa reponse.
  const surRienDuTout = computeInsightMeasurement({ before: [], after: [] });
  ok(surRienDuTout.verdict === 'inconclusive' && surRienDuTout.sampleDays === 0,
    `MONTAGE : sur une fenetre vide le calcul rend deja 0 jour d echantillon (${JSON.stringify(surRienDuTout)})`);

  // Crochet AVANT rechargement : center-metrics destructure getPool au
  // chargement du module.
  const cheminDb = require.resolve('../lib/database');
  const cheminMetrics = require.resolve('../lib/center-metrics');
  const dbReel = require.cache[cheminDb];
  const metricsReel = require.cache[cheminMetrics];
  const base = require('../lib/database');
  const getPoolReel = base.getPool;

  const rejouer = async (lignesDuJour) => {
    const ecrits = [];
    base.getPool = () => ({
      query: async (sql, params) => {
        const texte = String(sql);
        if (/from marketing_insights/i.test(texte) && /status = 'applied'/i.test(texte)) {
          return { rows: [{ id: 77, applied_date: '2026-08-27', payload: { angle: 'creneau_calme' } }] };
        }
        if (/update marketing_insights/i.test(texte)) { ecrits.push(params); return { rows: [] }; }
        if (/from daily_center_metrics/i.test(texte)) return { rows: lignesDuJour };
        return { rows: [] };
      },
    });
    delete require.cache[cheminMetrics];
    const frais = require('../lib/center-metrics');
    const verdict = await frais.measureAppliedInsights({ centerId: 'libramont' });
    return { verdict, ecrits };
  };

  // LE POINT : aucune ligne dans la fenetre, aucune ecriture.
  const surBaseVide = await rejouer([]);
  ok(surBaseVide.ecrits.length === 0,
    `LE POINT : sur une base sans metriques, AUCUN verdict n est ecrit (${surBaseVide.ecrits.length} ecriture(s))`);
  ok((surBaseVide.verdict.reportees || []).includes(77),
    `l idee est rendue comme REPORTEE, pas silencieusement sautee (${JSON.stringify(surBaseVide.verdict.reportees)})`);
  ok((surBaseVide.verdict.measured || []).length === 0,
    'et elle ne compte pas comme mesuree');

  // CONTRE-PREUVE : des lignes existent, la comparaison ne conclut pas. C est
  // un VRAI « non concluant » : les jours ont existe, l effet ne s est pas vu.
  // Sans cette assertion, tout reporter aurait aussi rendu le gate vert.
  const deuxJours = [
    { date: '2026-08-20', visitors: 10, revenue_total: 100, is_school_holiday: false, weather_tmax: 20, weather_precip_mm: 0 },
    { date: '2026-09-01', visitors: 12, revenue_total: 120, is_school_holiday: false, weather_tmax: 20, weather_precip_mm: 0 },
  ];
  const surDeuxJours = await rejouer(deuxJours);
  ok(surDeuxJours.ecrits.length === 1,
    `CONTRE-PREUVE : des lignes presentes, le verdict est bien ecrit (${surDeuxJours.ecrits.length} ecriture(s))`);
  ok(!(surDeuxJours.verdict.reportees || []).includes(77),
    'et l idee n est PAS reportee : elle a ete regardee');


  // ── QUI A IGNORE CETTE IDEE ? ───────────────────────────────────────────
  console.log('\n[CAUSE] chaque geste qui ignore une idee signe le sien');

  // Le refus du panneau : propositionAction accepte un `query` injectable.
  const { propositionAction } = require('../lib/marketing-brief');
  const sqlRefus = [];
  await propositionAction('libramont', { action: 'refusee', id: 42 }, {
    query: async (texte, params) => { sqlRefus.push({ texte: String(texte), params }); return { rows: [{ id: 42 }] }; },
  });
  ok(sqlRefus.length >= 2, `MONTAGE : le refus emet bien deux instructions (${sqlRefus.length})`);
  ok(sqlRefus.some((r) => /ignoredBy', 'staff'/.test(r.texte) && /update marketing_insights/i.test(r.texte)),
    'LE POINT : le refus du panneau ECRIT la cause staff');
  ok(sqlRefus.some((r) => /ignoredBy/.test(r.texte)
    && Array.isArray(r.params) && Number(r.params[0]) === 42 && r.params[1] === 'libramont'),
    'et il la porte sur l id refuse, dans SON centre');

  // CONTRE-PREUVE : publier ne signe aucun refus.
  const sqlPublie = [];
  await propositionAction('libramont', { action: 'publiee', id: 43 }, {
    query: async (texte) => { sqlPublie.push(String(texte)); return { rows: [{ id: 43 }] }; },
  }).catch(() => null);
  ok(!sqlPublie.some((t) => /ignoredBy/.test(t)),
    'CONTRE-PREUVE : publier n ecrit aucune cause de refus');

  // Le bouton du cockpit et l expiration passent par getPool : meme crochet
  // que le report de mesure, pose AVANT le rechargement du module.
  const rejouerStatut = async (statut) => {
    const emis = [];
    base.getPool = () => ({
      query: async (sql, params) => { emis.push({ texte: String(sql), params }); return { rows: [{ id: 9, status: statut, applied_at: null }] }; },
    });
    delete require.cache[cheminMetrics];
    const frais = require('../lib/center-metrics');
    await frais.setInsightStatus(9, statut, { centerId: 'libramont' });
    return emis;
  };
  const surIgnore = await rejouerStatut('ignored');
  ok(surIgnore.some((r) => /ignoredBy', 'staff'/.test(r.texte)),
    `LE POINT : le bouton Ignorer ECRIT la cause staff (${surIgnore.length} instruction(s))`);
  const surApplique = await rejouerStatut('applied');
  ok(!surApplique.some((r) => /ignoredBy/.test(r.texte)),
    'CONTRE-PREUVE : appliquer n ecrit aucune cause de refus');

  // L expiration : meme harnais, on regarde son UPDATE.
  const expiration = [];
  base.getPool = () => ({
    query: async (sql) => { expiration.push(String(sql)); return { rows: [] }; },
  });
  delete require.cache[cheminMetrics];
  await require('../lib/center-metrics').expireStaleInsights('libramont', '2026-09-10');
  ok(expiration.some((t) => /ignoredBy', 'expiration'/.test(t) && /set status = 'ignored'/.test(t)),
    'LE POINT : l expiration ECRIT sa cause dans le meme update');

  base.getPool = getPoolReel;
  if (metricsReel) require.cache[cheminMetrics] = metricsReel;
  base.getPool = getPoolReel;
  if (dbReel) require.cache[cheminDb] = dbReel;
  if (metricsReel) require.cache[cheminMetrics] = metricsReel;
  if (failures) { console.error(`\ndaily-metrics-check: ${failures} FAIL`); process.exit(1); }
  console.log('\ndaily-metrics-check: ALL OK');
})().catch((error) => { console.error('FAIL  gate interrompu :', error && error.stack || error); process.exit(1); });
