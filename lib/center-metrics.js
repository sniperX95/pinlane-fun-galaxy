// Warehouse quotidien du centre + faits data pour l'agent marketing.
//
// Philosophie (northstar) : le LLM ne calcule JAMAIS un chiffre. Tout fait vient
// de SQL sur daily_center_metrics ; les fonctions de calcul sont PURES et testées
// (scripts/daily-metrics-check.js) ; la couche réseau (Open-Meteo) est injectable
// et non-fatale (un cron sans météo écrit quand même les métriques).
//
// Seuils Libramont (normales IRM 1981-2010) : « chaud local » >= 23 °C (au-dessus
// de la normale, fréquent), « vraiment chaud » >= 25 °C (~18 j/an), « pluie
// marquante » >= 10 mm (~39 j/an — >= 1 mm couvre 43 % des jours, trop banal).

const { getPool } = require('./database');
const { callLlmJson } = require('./llm-client');

const HEAT_THRESHOLD_C = 23;
const STRONG_HEAT_THRESHOLD_C = 25;
const RAIN_THRESHOLD_MM = 10;
// En dessous de 90 jours de données, tout est exploratoire (méthodo R4 :
// < 3 mois = aucune conclusion ferme, 12 mois = premier signal honnête).
const EXPLORATORY_DATA_DAYS = 90;
// Minimum de jours comparables par case (ex. « samedis pluvieux ») pour émettre
// un fait — en dessous, le fait est omis plutôt que trompeur.
const MIN_SAMPLE_PER_BUCKET = 4;

const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Coordonnées par centre (Open-Meteo). Libramont = valeurs IRM/OSM.
const CENTER_COORDS = {
  libramont: { latitude: 49.92, longitude: 5.31 },
  gembloux: { latitude: 50.56, longitude: 4.69 },
};

// Événements locaux connus, datés et sourcés — utilisés comme déclencheurs
// d'idées. Foire de Libramont : dates officielles foiredelibramont.com (100e
// édition), plus grande foire agricole à ciel ouvert d'Europe, à ~5 min du centre.
const LOCAL_EVENTS = [
  { centerId: 'libramont', from: '2026-07-24', to: '2026-07-27', label: 'Foire de Libramont' },
];

// Congés scolaires FWB (RTBF + enseignement.be croisés). Rythme réforme 2022 :
// 7 semaines de cours / 2 semaines de congé (Carnaval variable).
const SCHOOL_HOLIDAYS_FWB = [
  { from: '2025-07-05', to: '2025-08-24', label: "Vacances d'été 2025" },
  { from: '2025-10-20', to: '2025-11-02', label: "Congé d'automne (Toussaint)" },
  { from: '2025-12-22', to: '2026-01-02', label: "Vacances d'hiver (Noël)" },
  { from: '2026-02-16', to: '2026-02-22', label: 'Congé de détente (Carnaval)' },
  { from: '2026-04-27', to: '2026-05-08', label: 'Congé de printemps' },
  { from: '2026-07-03', to: '2026-08-23', label: "Vacances d'été 2026" },
  { from: '2026-10-19', to: '2026-10-30', label: "Congé d'automne (Toussaint)" },
  { from: '2026-12-21', to: '2027-01-01', label: "Vacances d'hiver (Noël)" },
  { from: '2027-02-22', to: '2027-03-05', label: 'Congé de détente (Carnaval)' },
  { from: '2027-04-26', to: '2027-05-07', label: 'Congé de printemps' },
  { from: '2027-07-02', to: '2027-08-22', label: "Vacances d'été 2027" },
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return isoDate(date);
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

// Algorithme de Butcher (déterministe) : dimanche de Pâques grégorien.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Fériés légaux belges : 7 fixes + 3 mobiles dérivés de Pâques.
function publicHolidaysBE(year) {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, label: 'Nouvel An' },
    { date: addDaysIso(easter, 1), label: 'Lundi de Pâques' },
    { date: `${year}-05-01`, label: 'Fête du Travail' },
    { date: addDaysIso(easter, 39), label: 'Ascension' },
    { date: addDaysIso(easter, 50), label: 'Lundi de Pentecôte' },
    { date: `${year}-07-21`, label: 'Fête nationale' },
    { date: `${year}-08-15`, label: 'Assomption' },
    { date: `${year}-11-01`, label: 'Toussaint' },
    { date: `${year}-11-11`, label: 'Armistice' },
    { date: `${year}-12-25`, label: 'Noël' },
  ];
}

function isPublicHolidayBE(dateStr) {
  const year = Number(String(dateStr).slice(0, 4));
  const hit = publicHolidaysBE(year).find((holiday) => holiday.date === dateStr);
  return hit ? { holiday: true, label: hit.label } : { holiday: false, label: '' };
}

function isSchoolHolidayFWB(dateStr) {
  const hit = SCHOOL_HOLIDAYS_FWB.find((range) => dateStr >= range.from && dateStr <= range.to);
  return hit ? { holiday: true, label: hit.label } : { holiday: false, label: '' };
}

function nextSchoolHolidayFWB(fromDateStr) {
  const upcoming = SCHOOL_HOLIDAYS_FWB
    .filter((range) => range.from >= fromDateStr)
    .sort((a, b) => a.from.localeCompare(b.from));
  return upcoming[0] || null;
}

function upcomingLocalEvents(centerId, fromDateStr, horizonDays = 21) {
  const horizon = addDaysIso(fromDateStr, horizonDays);
  return LOCAL_EVENTS.filter((event) =>
    event.centerId === centerId && event.to >= fromDateStr && event.from <= horizon);
}

// ── Open-Meteo (réseau injectable, jamais fatal) ─────────────────────────────
// Sans clé = usage non-commercial (10k appels/jour). Passage commercial : poser
// OPEN_METEO_API_KEY → mêmes endpoints préfixés `customer-` + apikey.

function openMeteoHost(base) {
  return process.env.OPEN_METEO_API_KEY ? `customer-${base}` : base;
}

function openMeteoKeySuffix() {
  return process.env.OPEN_METEO_API_KEY ? `&apikey=${process.env.OPEN_METEO_API_KEY}` : '';
}

function centerCoords(centerId) {
  return CENTER_COORDS[centerId] || CENTER_COORDS.libramont;
}

async function fetchOpenMeteoDaily(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const daily = payload?.daily;
    if (!daily || !Array.isArray(daily.time)) return null;
    return daily.time.map((date, index) => ({
      date,
      tmax: toNumber(daily.temperature_2m_max?.[index], null),
      tmin: toNumber(daily.temperature_2m_min?.[index], null),
      precipMm: toNumber(daily.precipitation_sum?.[index], null),
      weatherCode: Number.isFinite(Number(daily.weather_code?.[index])) ? Number(daily.weather_code[index]) : null,
    }));
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteoArchive({ latitude, longitude, startDate, endDate, fetchImpl = fetch }) {
  const url = `https://${openMeteoHost('archive-api.open-meteo.com')}/v1/archive`
    + `?latitude=${latitude}&longitude=${longitude}`
    + `&start_date=${startDate}&end_date=${endDate}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code'
    + `&timezone=Europe%2FBrussels${openMeteoKeySuffix()}`;
  return fetchOpenMeteoDaily(url, fetchImpl);
}

async function fetchOpenMeteoForecast({ latitude, longitude, days = 14, fetchImpl = fetch }) {
  const url = `https://${openMeteoHost('api.open-meteo.com')}/v1/forecast`
    + `?latitude=${latitude}&longitude=${longitude}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code'
    + `&forecast_days=${Math.max(1, Math.min(16, Number(days) || 14))}`
    + `&timezone=Europe%2FBrussels${openMeteoKeySuffix()}`;
  return fetchOpenMeteoDaily(url, fetchImpl);
}

// ── Métriques quotidiennes ───────────────────────────────────────────────────

function reservationTypeBucket(reservation = {}) {
  const type = String(reservation.type || '').toLowerCase();
  if (type === 'laser') return 'laser';
  if (type === 'formule' || reservation.formuleId || reservation.formule_id) return 'formule';
  if (type === 'bowling') return 'bowling';
  return 'autre';
}

// Agrégation PURE d'une journée. `firstDateByClient` = Map clé client -> première
// date de résa toutes dates confondues (fournie par SQL ou par le test).
function computeMetricsFromReservations(dayReservations = [], firstDateByClient = new Map(), dateStr = '') {
  const active = dayReservations.filter((reservation) => reservation.status !== 'cancelled');
  const cancelled = dayReservations.length - active.length;
  const revenueByType = {};
  const paxByType = {};
  let revenueTotal = 0;
  let visitors = 0;
  for (const reservation of active) {
    const bucket = reservationTypeBucket(reservation);
    const price = toNumber(reservation.price, 0);
    const pax = toNumber(reservation.pax, 0);
    revenueByType[bucket] = Math.round(((revenueByType[bucket] || 0) + price) * 100) / 100;
    paxByType[bucket] = (paxByType[bucket] || 0) + pax;
    revenueTotal += price;
    visitors += pax;
  }
  const clientKeys = new Set(active
    .map((reservation) => String(reservation.phone || '').trim() || String(reservation.email || '').trim().toLowerCase())
    .filter(Boolean));
  let newClients = 0;
  for (const key of clientKeys) {
    if (firstDateByClient.get(key) === dateStr) newClients += 1;
  }
  return {
    visitors,
    reservationsCount: active.length,
    cancellationsCount: cancelled,
    revenueTotal: Math.round(revenueTotal * 100) / 100,
    revenueByType,
    paxByType,
    newClientsCount: newClients,
    avgBasket: active.length ? Math.round((revenueTotal / active.length) * 100) / 100 : 0,
  };
}

async function buildDailyMetricsForDate(centerId, dateStr, { client = null } = {}) {
  const pool = getPool();
  const runner = client || pool;
  const [dayResult, firstResult] = await Promise.all([
    runner.query(
      'select status, type, formule_id, pax, price, phone, email from reservations where center_id = $1 and date = $2;',
      [centerId, dateStr],
    ),
    runner.query(
      `
        select coalesce(nullif(trim(phone), ''), lower(trim(email))) as client_key, min(date)::text as first_date
        from reservations
        where center_id = $1
          and status <> 'cancelled'
          and coalesce(nullif(trim(phone), ''), nullif(trim(email), '')) is not null
        group by 1
        having min(date) = $2;
      `,
      [centerId, dateStr],
    ),
  ]);
  const firstDateByClient = new Map(firstResult.rows.map((row) => [row.client_key, row.first_date]));
  const rows = dayResult.rows.map((row) => ({
    status: row.status,
    type: row.type,
    formuleId: row.formule_id,
    pax: row.pax,
    price: row.price,
    phone: row.phone,
    email: row.email,
  }));
  return computeMetricsFromReservations(rows, firstDateByClient, dateStr);
}

async function upsertDailyMetrics(centerId, dateStr, metrics, weather = null) {
  const school = isSchoolHolidayFWB(dateStr);
  const publicHoliday = isPublicHolidayBE(dateStr);
  await getPool().query(
    `
      insert into daily_center_metrics (
        center_id, date, visitors, reservations_count, cancellations_count,
        revenue_total, revenue_by_type, pax_by_type, new_clients_count, avg_basket,
        weather_tmax, weather_tmin, weather_precip_mm, weather_code,
        is_school_holiday, is_public_holiday, holiday_label, computed_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
      on conflict (center_id, date) do update set
        visitors = excluded.visitors,
        reservations_count = excluded.reservations_count,
        cancellations_count = excluded.cancellations_count,
        revenue_total = excluded.revenue_total,
        revenue_by_type = excluded.revenue_by_type,
        pax_by_type = excluded.pax_by_type,
        new_clients_count = excluded.new_clients_count,
        avg_basket = excluded.avg_basket,
        weather_tmax = coalesce(excluded.weather_tmax, daily_center_metrics.weather_tmax),
        weather_tmin = coalesce(excluded.weather_tmin, daily_center_metrics.weather_tmin),
        weather_precip_mm = coalesce(excluded.weather_precip_mm, daily_center_metrics.weather_precip_mm),
        weather_code = coalesce(excluded.weather_code, daily_center_metrics.weather_code),
        is_school_holiday = excluded.is_school_holiday,
        is_public_holiday = excluded.is_public_holiday,
        holiday_label = excluded.holiday_label,
        computed_at = now();
    `,
    [
      centerId, dateStr,
      metrics.visitors, metrics.reservationsCount, metrics.cancellationsCount,
      metrics.revenueTotal, JSON.stringify(metrics.revenueByType), JSON.stringify(metrics.paxByType),
      metrics.newClientsCount, metrics.avgBasket,
      weather?.tmax ?? null, weather?.tmin ?? null, weather?.precipMm ?? null, weather?.weatherCode ?? null,
      school.holiday, publicHoliday.holiday,
      publicHoliday.label || school.label || '',
    ],
  );
}

// Consolide UNE journée : métriques résas + météo (archive si dispo, sinon
// fallback prévision déjà stockée). La météo manquante n'empêche jamais l'écriture.
async function collectDailyMetrics({ centerId = 'libramont', date, fetchImpl = fetch } = {}) {
  const dateStr = date || addDaysIso(isoDate(new Date()), -1);
  const metrics = await buildDailyMetricsForDate(centerId, dateStr);
  let weather = null;
  try {
    const coords = centerCoords(centerId);
    const archive = await fetchOpenMeteoArchive({ ...coords, startDate: dateStr, endDate: dateStr, fetchImpl });
    weather = archive?.find((row) => row.date === dateStr) || null;
    if (!weather || weather.tmax === null) {
      const stored = await getPool().query(
        'select tmax, tmin, precip_mm, weather_code from weather_daily_forecast where center_id = $1 and date = $2;',
        [centerId, dateStr],
      );
      if (stored.rows[0]) {
        weather = {
          tmax: toNumber(stored.rows[0].tmax, null),
          tmin: toNumber(stored.rows[0].tmin, null),
          precipMm: toNumber(stored.rows[0].precip_mm, null),
          weatherCode: stored.rows[0].weather_code,
        };
      }
    }
  } catch (error) {
    weather = null;
  }
  await upsertDailyMetrics(centerId, dateStr, metrics, weather);
  return { ok: true, centerId, date: dateStr, metrics, weather: Boolean(weather) };
}

// Dates récentes sans ligne warehouse (rattrapage borné du cron).
async function listMissingMetricDates(centerId, fromDateStr, toDateStr) {
  const result = await getPool().query(
    `
      select gs.date::text as date
      from generate_series($2::date, $3::date, interval '1 day') as gs(date)
      left join daily_center_metrics m on m.center_id = $1 and m.date = gs.date
      where m.date is null
      order by gs.date asc;
    `,
    [centerId, fromDateStr, toDateStr],
  );
  return result.rows.map((row) => row.date);
}

async function refreshWeatherForecast(centerId = 'libramont', { fetchImpl = fetch } = {}) {
  const coords = centerCoords(centerId);
  const forecast = await fetchOpenMeteoForecast({ ...coords, days: 14, fetchImpl });
  if (!forecast) return { ok: false, centerId, message: 'Prévision météo indisponible.' };
  for (const row of forecast) {
    await getPool().query(
      `
        insert into weather_daily_forecast (center_id, date, tmax, tmin, precip_mm, weather_code, fetched_at)
        values ($1,$2,$3,$4,$5,$6,now())
        on conflict (center_id, date) do update set
          tmax = excluded.tmax, tmin = excluded.tmin,
          precip_mm = excluded.precip_mm, weather_code = excluded.weather_code,
          fetched_at = now();
      `,
      [centerId, row.date, row.tmax, row.tmin, row.precipMm, row.weatherCode],
    );
  }
  return { ok: true, centerId, days: forecast.length };
}

// ── Faits data (calcul PUR, contrôlé jour-de-semaine) ────────────────────────

function averageOf(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + toNumber(row[key], 0), 0) / rows.length;
}

function pctDelta(after, before) {
  if (!before) return null;
  return Math.round(((after - before) / before) * 100);
}

// Compare deux sous-ensembles (ex. pluie vs sec) EN CONTRÔLANT le jour de
// semaine : delta calculé par jour-de-semaine éligible (n >= MIN_SAMPLE des deux
// côtés), puis moyenné. Évite le biais « il pleut plus souvent en semaine ».
function dowControlledDelta(rows, predicate, key = 'visitors') {
  const byDow = new Map();
  for (const row of rows) {
    const dow = dayOfWeek(row.date);
    if (!byDow.has(dow)) byDow.set(dow, { hit: [], miss: [] });
    byDow.get(dow)[predicate(row) ? 'hit' : 'miss'].push(row);
  }
  const deltas = [];
  let hitDays = 0;
  for (const { hit, miss } of byDow.values()) {
    if (hit.length < MIN_SAMPLE_PER_BUCKET || miss.length < MIN_SAMPLE_PER_BUCKET) continue;
    const delta = pctDelta(averageOf(hit, key), averageOf(miss, key));
    if (delta === null) continue;
    deltas.push(delta);
    hitDays += hit.length;
  }
  if (!deltas.length) return null;
  return {
    deltaPct: Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length),
    sampleSize: hitDays,
  };
}

function confidenceFor(dataDays, sampleSize) {
  if (dataDays < EXPLORATORY_DATA_DAYS) return 'exploratoire';
  return sampleSize >= 12 ? 'solide' : 'signal';
}

// rows = lignes daily_center_metrics {date, visitors, revenue_total, weather_*,
// is_school_holiday}. Retourne des FAITS chiffrés, phrase FR + échantillon.
function computeFactsFromRows(rows = []) {
  const facts = [];
  const dataDays = rows.length;
  if (!dataDays) return { facts, dataDays };

  if (dataDays < EXPLORATORY_DATA_DAYS) {
    facts.push({
      id: 'data_age',
      label: `Données encore jeunes (${dataDays} jours) — tendances indicatives, pas de conclusion ferme.`,
      value: dataDays,
      sampleSize: dataDays,
      confidence: 'exploratoire',
    });
  }

  // Meilleur / pire jour de semaine (moyenne visiteurs).
  const byDow = new Map();
  for (const row of rows) {
    const dow = dayOfWeek(row.date);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow).push(row);
  }
  const dowAverages = [...byDow.entries()]
    .filter(([, dowRows]) => dowRows.length >= MIN_SAMPLE_PER_BUCKET)
    .map(([dow, dowRows]) => ({
      dow,
      avgVisitors: Math.round(averageOf(dowRows, 'visitors')),
      avgRevenue: Math.round(averageOf(dowRows, 'revenue_total')),
      sample: dowRows.length,
    }))
    .sort((a, b) => b.avgVisitors - a.avgVisitors);
  if (dowAverages.length >= 2) {
    const best = dowAverages[0];
    const worst = dowAverages[dowAverages.length - 1];
    facts.push({
      id: 'dow_best',
      label: `Le ${DAY_LABELS_FR[best.dow]} est ton jour le plus fort : ${best.avgVisitors} visiteurs et ${best.avgRevenue} € en moyenne (sur ${best.sample} ${DAY_LABELS_FR[best.dow]}s).`,
      value: best.avgVisitors,
      dow: best.dow,
      sampleSize: best.sample,
      confidence: confidenceFor(dataDays, best.sample),
    });
    facts.push({
      id: 'dow_worst',
      label: `Le ${DAY_LABELS_FR[worst.dow]} est ton jour le plus calme : ${worst.avgVisitors} visiteurs en moyenne (sur ${worst.sample} ${DAY_LABELS_FR[worst.dow]}s).`,
      value: worst.avgVisitors,
      dow: worst.dow,
      sampleSize: worst.sample,
      confidence: confidenceFor(dataDays, worst.sample),
    });
  }

  // Météo : uniquement les jours qui ONT une météo consolidée.
  const weatherRows = rows.filter((row) => row.weather_tmax !== null && row.weather_tmax !== undefined);
  const rain = dowControlledDelta(weatherRows, (row) => toNumber(row.weather_precip_mm, 0) >= RAIN_THRESHOLD_MM);
  if (rain) {
    facts.push({
      id: 'rain_effect',
      label: `Les jours de vraie pluie (≥ ${RAIN_THRESHOLD_MM} mm), la fréquentation est ${rain.deltaPct >= 0 ? '+' : ''}${rain.deltaPct} % vs jours secs comparables (sur ${rain.sampleSize} jours de pluie).`,
      value: rain.deltaPct,
      sampleSize: rain.sampleSize,
      confidence: confidenceFor(dataDays, rain.sampleSize),
    });
  }
  const heat = dowControlledDelta(weatherRows, (row) => toNumber(row.weather_tmax, -99) >= HEAT_THRESHOLD_C);
  if (heat) {
    facts.push({
      id: 'heat_effect',
      label: `Les jours chauds (≥ ${HEAT_THRESHOLD_C} °C), la fréquentation est ${heat.deltaPct >= 0 ? '+' : ''}${heat.deltaPct} % vs jours comparables (sur ${heat.sampleSize} jours chauds).`,
      value: heat.deltaPct,
      sampleSize: heat.sampleSize,
      confidence: confidenceFor(dataDays, heat.sampleSize),
    });
  }
  const strongHeat = dowControlledDelta(weatherRows, (row) => toNumber(row.weather_tmax, -99) >= STRONG_HEAT_THRESHOLD_C);
  if (strongHeat) {
    facts.push({
      id: 'strong_heat_effect',
      label: `Les jours très chauds (≥ ${STRONG_HEAT_THRESHOLD_C} °C), la fréquentation est ${strongHeat.deltaPct >= 0 ? '+' : ''}${strongHeat.deltaPct} % (sur ${strongHeat.sampleSize} jours).`,
      value: strongHeat.deltaPct,
      sampleSize: strongHeat.sampleSize,
      confidence: confidenceFor(dataDays, strongHeat.sampleSize),
    });
  }

  // Vacances scolaires FWB vs hors vacances (contrôle jour-de-semaine).
  const holiday = dowControlledDelta(rows, (row) => Boolean(row.is_school_holiday));
  if (holiday) {
    facts.push({
      id: 'school_holiday_effect',
      label: `Pendant les congés scolaires FWB, la fréquentation est ${holiday.deltaPct >= 0 ? '+' : ''}${holiday.deltaPct} % vs jours comparables hors congés (sur ${holiday.sampleSize} jours de congé).`,
      value: holiday.deltaPct,
      sampleSize: holiday.sampleSize,
      confidence: confidenceFor(dataDays, holiday.sampleSize),
    });
  }

  // Tendance : 4 dernières semaines vs 4 précédentes.
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length >= 56) {
    const last28 = sorted.slice(-28);
    const prev28 = sorted.slice(-56, -28);
    const delta = pctDelta(averageOf(last28, 'visitors'), averageOf(prev28, 'visitors'));
    if (delta !== null) {
      facts.push({
        id: 'trend_4w',
        label: `Sur les 4 dernières semaines, la fréquentation est ${delta >= 0 ? '+' : ''}${delta} % vs les 4 semaines précédentes.`,
        value: delta,
        sampleSize: 28,
        confidence: confidenceFor(dataDays, 28),
      });
    }
  }

  return { facts, dataDays };
}

async function analyzeCenterData(centerId = 'libramont', { periodDays = 365 } = {}) {
  const result = await getPool().query(
    `
      select date::text as date, visitors, revenue_total, weather_tmax, weather_precip_mm, is_school_holiday
      from daily_center_metrics
      where center_id = $1 and date >= (current_date - $2::int)
      order by date asc;
    `,
    [centerId, Number(periodDays) || 365],
  );
  return computeFactsFromRows(result.rows.map((row) => ({
    ...row,
    weather_tmax: row.weather_tmax === null ? null : toNumber(row.weather_tmax, null),
    weather_precip_mm: row.weather_precip_mm === null ? null : toNumber(row.weather_precip_mm, null),
  })));
}

// ── Idées (déclencheurs déterministes → contenu prêt à poster) ───────────────

function makeIdeaSignature(trigger, channel) {
  return `${trigger}:${channel}`;
}

// Renders : templates SANS aucun chiffre inventé — uniquement les valeurs des
// déclencheurs (météo prévue, dates, moyennes des facts). Aucune promo chiffrée
// n'est promise (forbiddenClaims marketing : pas de « réduction garantie ») —
// l'offre exacte reste la décision du gérant, l'idée la suggère sans l'annoncer.
function renderIdeaContent(candidate) {
  if (candidate.trigger === 'rain_forecast') {
    return `Pluie annoncée ${candidate.dayLabel} (${candidate.precipMm} mm) ? Zéro goutte chez nous : bowling, laser game et arcades bien au sec. Pense à réserver ta piste avant que tout le monde ait la même idée.`;
  }
  if (candidate.trigger === 'heat_forecast') {
    return `${candidate.tmax}° annoncés ${candidate.dayLabel} — chez nous il fait frais toute la journée. Bowling, laser game, arcades : le plan fraîcheur à 5 minutes.`;
  }
  if (candidate.trigger === 'school_holiday') {
    return `${candidate.holidayLabel} : c'est le ${candidate.startLabel} que ça commence. Anniversaires, sorties en famille, après-midis entre amis — réserve ton créneau maintenant, les vacances partent vite.`;
  }
  if (candidate.trigger === 'local_event') {
    return `${candidate.eventLabel} (${candidate.eventDates}) : on est à 5 minutes. Avant ou après votre visite, pause bowling, laser game ou arcades — au calme et au frais.`;
  }
  if (candidate.trigger === 'quiet_day') {
    return `Idée interne : le ${candidate.dayLabel} est ton jour le plus calme (${candidate.avgVisitors} visiteurs en moyenne, sur ${candidate.sampleSize} ${candidate.dayLabel}s). Une offre spéciale ${candidate.dayLabel} hors vacances (école, seniors, afterwork) peut remplir ce creux.`;
  }
  return candidate.title || '';
}

// Dérive 0-3 candidats d'idées depuis prévision + calendrier + facts. PURE
// (le `today` est injecté). Priorité : météo (actionnable J+2/J+3, pattern
// « anticiper sur prévision ») > événement local > vacances > jour creux.
function deriveIdeaCandidates({ today, forecast = [], facts = [], nextHoliday = null, localEvents = [] } = {}) {
  const candidates = [];

  // Météo J+2 / J+3 (fenêtre d'anticipation documentée : poster 2-3 j avant).
  for (const offset of [2, 3]) {
    const target = addDaysIso(today, offset);
    const day = forecast.find((row) => row.date === target);
    if (!day) continue;
    const dayLabel = DAY_LABELS_FR[dayOfWeek(target)];
    if (toNumber(day.precipMm, 0) >= RAIN_THRESHOLD_MM) {
      candidates.push({
        trigger: 'rain_forecast',
        channel: 'facebook',
        kind: 'idea',
        title: `Post « plan pluie » pour ${dayLabel} ${target}`,
        why: `Prévision Open-Meteo : ${day.precipMm} mm de pluie ${dayLabel} (${target}). Indoor = refuge — poster 2-3 jours avant, pas le jour même.`,
        dayLabel: `${dayLabel} ${target.slice(8, 10)}/${target.slice(5, 7)}`,
        precipMm: Math.round(toNumber(day.precipMm, 0)),
        dataBasis: [{ source: 'weather_daily_forecast', date: target, precipMm: day.precipMm }],
      });
      break;
    }
    if (toNumber(day.tmax, -99) >= STRONG_HEAT_THRESHOLD_C) {
      candidates.push({
        trigger: 'heat_forecast',
        channel: 'facebook',
        kind: 'idea',
        title: `Post « plan fraîcheur » pour ${dayLabel} ${target}`,
        why: `Prévision Open-Meteo : ${Math.round(day.tmax)} °C ${dayLabel} (${target}) — rare en Ardenne (~18 j/an ≥ 25 °C). À tester localement : l'effet chaleur sur l'indoor n'est pas tranché par la littérature.`,
        dayLabel: `${dayLabel} ${target.slice(8, 10)}/${target.slice(5, 7)}`,
        tmax: Math.round(toNumber(day.tmax, 0)),
        dataBasis: [{ source: 'weather_daily_forecast', date: target, tmax: day.tmax }],
      });
      break;
    }
  }

  // Événement local à ≤ 14 jours (ex. Foire de Libramont — afflux à 5 min).
  const event = localEvents.find((item) => item.from <= addDaysIso(today, 14));
  if (event) {
    candidates.push({
      trigger: 'local_event',
      channel: 'facebook',
      kind: 'idea',
      title: `Post « ${event.label} »`,
      why: `${event.label} du ${event.from} au ${event.to}, à 5 minutes du centre : afflux massif de familles dans la commune.`,
      eventLabel: event.label,
      eventDates: `${event.from.slice(8, 10)}/${event.from.slice(5, 7)} → ${event.to.slice(8, 10)}/${event.to.slice(5, 7)}`,
      dataBasis: [{ source: 'local_events', from: event.from, to: event.to, label: event.label }],
    });
  }

  // Congé scolaire FWB qui démarre à ≤ 14 jours.
  if (nextHoliday && nextHoliday.from <= addDaysIso(today, 14) && nextHoliday.from >= today) {
    candidates.push({
      trigger: 'school_holiday',
      channel: 'facebook',
      kind: 'idea',
      title: `Post « ${nextHoliday.label} »`,
      why: `${nextHoliday.label} démarre le ${nextHoliday.from} (calendrier officiel FWB) : pic de demande familles à anticiper.`,
      holidayLabel: nextHoliday.label,
      startLabel: `${nextHoliday.from.slice(8, 10)}/${nextHoliday.from.slice(5, 7)}`,
      dataBasis: [{ source: 'school_holidays_fwb', from: nextHoliday.from, to: nextHoliday.to }],
    });
  }

  // Jour creux récurrent — UNIQUEMENT mardi (2) ou jeudi (4) : le mercredi
  // après-midi belge n'est PAS un creux (les enfants n'ont pas cours).
  const worst = facts.find((fact) => fact.id === 'dow_worst');
  if (worst && [2, 4].includes(worst.dow)) {
    candidates.push({
      trigger: 'quiet_day',
      channel: 'email',
      kind: 'idea',
      title: `Remplir le creux du ${DAY_LABELS_FR[worst.dow]}`,
      why: worst.label,
      dayLabel: DAY_LABELS_FR[worst.dow],
      avgVisitors: worst.value,
      sampleSize: worst.sampleSize,
      dataBasis: [{ source: 'daily_center_metrics', factId: worst.id, value: worst.value, sampleSize: worst.sampleSize }],
    });
  }

  return candidates.slice(0, 3).map((candidate) => ({
    ...candidate,
    signature: makeIdeaSignature(candidate.trigger, candidate.channel),
    readyContent: renderIdeaContent(candidate),
  }));
}

// Amélioration OPTIONNELLE du texte par IA (Claude prioritaire, OpenAI sinon —
// gated par la clé, fallback template silencieux). GROUNDING DUR : le modèle
// reformule, il n'a pas le droit d'ajouter un chiffre, une promo ou une
// activité absente des faits fournis — et on rejette sa sortie si un nombre
// inconnu apparaît.
async function polishIdeaWithAi(candidate, { fetchImpl = fetch } = {}) {
  const { COPY_SYSTEM_CORE, channelPlaybook, COPY_FINAL_REMINDER } = require('./copy-playbook');
  const result = await callLlmJson({
    stableSystem: [
      'Tu réécris un post réseau social pour un centre de loisirs indoor belge (bowling, laser game, arcades).',
      'RÈGLE ABSOLUE : tu rédiges UNIQUEMENT à partir des faits fournis. INTERDIT d\'ajouter un chiffre, un pourcentage, un prix, une promotion ou une activité qui n\'y figure pas. Les chiffres des exemples canoniques sont un ADN d\'écriture, PAS des faits.',
      COPY_SYSTEM_CORE,
      'Réponds uniquement en JSON conforme au schéma.',
    ].join('\n\n'),
    user: JSON.stringify({
      baseContent: candidate.readyContent,
      facts: candidate.dataBasis,
      why: candidate.why,
      canal: channelPlaybook(candidate.channel || 'facebook'),
      rappel: `${COPY_FINAL_REMINDER} CONTRAINTE DURE : ta réécriture ne contient QUE des nombres déjà présents dans baseContent ou facts — AUCUN autre, pas même ceux de l'exemple canonique (ils appartiennent à un autre centre). Si tu veux dire que c'est rapide, dis-le sans chiffre.`,
    }),
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
    schemaName: 'polished_idea',
    maxTokens: 400,
    timeoutMs: 10000,
    fetchImpl,
  });
  if (!result) return null;
  const content = String(result.content || '').trim();
  if (!content) return null;
  // Garde-fou anti-invention : tout nombre de la sortie doit exister dans le
  // template ou les faits (tolère les formats de date recomposés).
  const allowed = `${candidate.readyContent} ${JSON.stringify(candidate.dataBasis)} ${candidate.why || ''}`;
  const numbers = content.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of numbers) {
    const canonical = number.replace(',', '.');
    if (!allowed.includes(number) && !allowed.includes(canonical)) return null;
  }
  return content;
}

// ── Persistance des idées + mesure avant/après ───────────────────────────────

async function insertIdeaIfNew(centerId, idea) {
  const pool = getPool();
  const existing = await pool.query(
    `
      select 1 from marketing_insights
      where center_id = $1 and signature = $2 and status <> 'ignored'
        and proposed_at > now() - interval '7 days'
      limit 1;
    `,
    [centerId, idea.signature],
  );
  if (existing.rows[0]) return { inserted: false, reason: 'dedupe_7d' };
  await pool.query(
    `
      insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature)
      values ($1,$2,$3,$4,$5,$6,$7,$8);
    `,
    [centerId, idea.kind || 'idea', idea.title, idea.why || '', idea.channel, idea.readyContent, JSON.stringify(idea.dataBasis || []), idea.signature],
  );
  return { inserted: true };
}

// Bundle complet des faits data pour le signal pack marketing.
async function buildDataFactsBundle(centerId = 'libramont', { today = null, fetchImpl = fetch } = {}) {
  const todayStr = today || isoDate(new Date());
  const analysis = await analyzeCenterData(centerId);
  const forecastResult = await getPool().query(
    `
      select date::text as date, tmax, tmin, precip_mm, weather_code
      from weather_daily_forecast
      where center_id = $1 and date >= $2 and date <= $3
      order by date asc;
    `,
    [centerId, todayStr, addDaysIso(todayStr, 7)],
  );
  const forecast = forecastResult.rows.map((row) => ({
    date: row.date,
    tmax: toNumber(row.tmax, null),
    tmin: toNumber(row.tmin, null),
    precipMm: toNumber(row.precip_mm, null),
    weatherCode: row.weather_code,
  }));
  const year = Number(todayStr.slice(0, 4));
  const upcomingHolidays = [...publicHolidaysBE(year), ...publicHolidaysBE(year + 1)]
    .filter((holiday) => holiday.date >= todayStr && holiday.date <= addDaysIso(todayStr, 21));
  return {
    today: todayStr,
    facts: analysis.facts,
    dataDays: analysis.dataDays,
    forecast7: forecast,
    nextSchoolHoliday: nextSchoolHolidayFWB(todayStr),
    upcomingPublicHolidays: upcomingHolidays,
    localEvents: upcomingLocalEvents(centerId, todayStr),
  };
}

// Cycle idées : déclencheurs → 0-3 idées → polish IA optionnel → insert dédupé.
async function runDataIdeasCycle({ centerId = 'libramont', bundle = null, fetchImpl = fetch } = {}) {
  const dataBundle = bundle || await buildDataFactsBundle(centerId, { fetchImpl });
  const candidates = deriveIdeaCandidates({
    today: dataBundle.today,
    forecast: dataBundle.forecast7,
    facts: dataBundle.facts,
    nextHoliday: dataBundle.nextSchoolHoliday,
    localEvents: dataBundle.localEvents,
  });
  const results = [];
  for (const candidate of candidates) {
    const polished = await polishIdeaWithAi(candidate, { fetchImpl });
    const idea = polished ? { ...candidate, readyContent: polished } : candidate;
    const outcome = await insertIdeaIfNew(centerId, idea);
    results.push({ signature: idea.signature, title: idea.title, ...outcome });
  }
  return { ok: true, centerId, candidates: candidates.length, results };
}

// Mesure PURE avant/après : rows {date, visitors, revenue_total,
// is_school_holiday} sur [applied-14j, applied) et (applied, applied+14j].
// Compare par jour-de-semaine, en excluant les paires au statut vacances
// asymétrique. Verdict : validated > +10 %, refuted < -10 %, sinon inconclusive.
function computeInsightMeasurement({ before = [], after = [] } = {}) {
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const dow = dayOfWeek(row.date);
      if (!map.has(dow)) map.set(dow, []);
      map.get(dow).push(row);
    }
    return map;
  };
  const beforeByDow = group(before);
  const afterByDow = group(after);
  const deltas = [];
  let sampleDays = 0;
  let beforeAvgSum = 0;
  let afterAvgSum = 0;
  for (const [dow, beforeRows] of beforeByDow.entries()) {
    const afterRows = afterByDow.get(dow) || [];
    if (!beforeRows.length || !afterRows.length) continue;
    // Asymétrie vacances : si un côté est majoritairement en congé et pas
    // l'autre, la comparaison ne mesure pas l'idée — on saute ce jour.
    const beforeHoliday = beforeRows.filter((row) => row.is_school_holiday).length / beforeRows.length;
    const afterHoliday = afterRows.filter((row) => row.is_school_holiday).length / afterRows.length;
    if (Math.abs(beforeHoliday - afterHoliday) > 0.5) continue;
    const beforeAvg = averageOf(beforeRows, 'visitors');
    const afterAvg = averageOf(afterRows, 'visitors');
    const delta = pctDelta(afterAvg, beforeAvg);
    if (delta === null) continue;
    deltas.push(delta);
    sampleDays += Math.min(beforeRows.length, afterRows.length);
    beforeAvgSum += beforeAvg;
    afterAvgSum += afterAvg;
  }
  if (!deltas.length || sampleDays < MIN_SAMPLE_PER_BUCKET) {
    return { verdict: 'inconclusive', deltaPct: null, sampleDays, before: null, after: null };
  }
  const deltaPct = Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length);
  return {
    verdict: deltaPct > 10 ? 'validated' : deltaPct < -10 ? 'refuted' : 'inconclusive',
    deltaPct,
    sampleDays,
    before: Math.round(beforeAvgSum / deltas.length),
    after: Math.round(afterAvgSum / deltas.length),
  };
}

// Mesure les idées appliquées depuis >= 14 jours et pas encore mesurées.
async function measureAppliedInsights({ centerId = 'libramont' } = {}) {
  const pool = getPool();
  const pending = await pool.query(
    `
      select id, applied_at::date::text as applied_date
      from marketing_insights
      where center_id = $1 and status = 'applied'
        and applied_at <= now() - interval '14 days'
        and measured_at is null
      limit 10;
    `,
    [centerId],
  );
  const measured = [];
  for (const row of pending.rows) {
    const appliedDate = row.applied_date;
    const windowResult = await pool.query(
      `
        select date::text as date, visitors, revenue_total, is_school_holiday
        from daily_center_metrics
        where center_id = $1 and date >= $2::date - 14 and date <= $2::date + 14 and date <> $2::date;
      `,
      [centerId, appliedDate],
    );
    const before = windowResult.rows.filter((item) => item.date < appliedDate);
    const after = windowResult.rows.filter((item) => item.date > appliedDate);
    const measurement = computeInsightMeasurement({ before, after });
    await pool.query(
      `
        update marketing_insights
        set status = $2, result = $3, measured_at = now()
        where id = $1;
      `,
      [row.id, measurement.verdict, JSON.stringify(measurement)],
    );
    measured.push({ id: Number(row.id), ...measurement });
  }
  return { ok: true, centerId, measured };
}

// ── Lecture / statut (API ops) ───────────────────────────────────────────────

async function listDailyMetrics(centerId, fromDateStr, toDateStr) {
  const result = await getPool().query(
    `
      select date::text as date, visitors, reservations_count, cancellations_count,
             revenue_total, revenue_by_type, pax_by_type, new_clients_count, avg_basket,
             weather_tmax, weather_tmin, weather_precip_mm, weather_code,
             is_school_holiday, is_public_holiday, holiday_label
      from daily_center_metrics
      where center_id = $1 and date >= $2 and date <= $3
      order by date asc;
    `,
    [centerId, fromDateStr, toDateStr],
  );
  const rows = result.rows.map((row) => ({
    ...row,
    visitors: toNumber(row.visitors, 0),
    revenue_total: toNumber(row.revenue_total, 0),
    avg_basket: toNumber(row.avg_basket, 0),
    weather_tmax: row.weather_tmax === null ? null : toNumber(row.weather_tmax, null),
    weather_precip_mm: row.weather_precip_mm === null ? null : toNumber(row.weather_precip_mm, null),
  }));
  const totals = {
    visitors: rows.reduce((sum, row) => sum + row.visitors, 0),
    revenue: Math.round(rows.reduce((sum, row) => sum + row.revenue_total, 0) * 100) / 100,
    days: rows.length,
  };
  const sortedByVisitors = [...rows].sort((a, b) => b.visitors - a.visitors);
  return {
    rows,
    totals,
    bestDay: sortedByVisitors[0] || null,
    worstDay: sortedByVisitors.length ? sortedByVisitors[sortedByVisitors.length - 1] : null,
  };
}

async function listMarketingInsights(centerId, { status = '', limit = 100 } = {}) {
  const params = [centerId];
  let where = 'center_id = $1';
  if (status) {
    params.push(status);
    where += ` and status = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
  const result = await getPool().query(
    `
      select id, center_id, kind, title, body, channel, ready_content, data_basis,
             signature, status, proposed_at, applied_at, measured_at, result
      from marketing_insights
      where ${where}
      order by proposed_at desc
      limit $${params.length};
    `,
    params,
  );
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

async function setInsightStatus(id, status) {
  if (!['applied', 'ignored'].includes(status)) {
    const error = new Error('Statut invalide (applied ou ignored).');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const result = await getPool().query(
    `
      update marketing_insights
      set status = $2, applied_at = case when $2 = 'applied' then now() else applied_at end
      where id = $1
      returning id, status, applied_at;
    `,
    [Number(id), status],
  );
  if (!result.rows[0]) {
    const error = new Error('Insight introuvable.');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  return { id: Number(result.rows[0].id), status: result.rows[0].status, appliedAt: result.rows[0].applied_at };
}

// « Ta période » : plage de dates LIBRE (demande Movsar — pas figée à 7 jours)
// vue par le copilote marketing — météo prévue + calendrier (congés FWB,
// fériés, événements locaux) + idées de l'agent rattachées à leur jour
// (targetDate du data_basis si présent, sinon posées sur le 1er jour).
// Défaut : aujourd'hui → +6 j. Cap 31 jours (au-delà la bande devient illisible
// et la prévision météo n'existe plus — J+14 max chez Open-Meteo).
async function buildMarketingWeek(centerId = 'libramont', { from = null, to = null, today = null } = {}) {
  const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
  const start = DATE_RX.test(from || '') ? from : (today || isoDate(new Date()));
  let end = DATE_RX.test(to || '') ? to : null;
  if (!end || end < start) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    end = d.toISOString().slice(0, 10);
  }
  const spanDays = Math.min(31, Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 864e5) + 1);
  const dates = [];
  for (let i = 0; i < spanDays; i += 1) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const forecast = await getPool().query(
    'select date::text as date, tmax, precip_mm, weather_code from weather_daily_forecast where center_id = $1 and date >= $2 and date <= $3;',
    [centerId, dates[0], dates[dates.length - 1]],
  ).catch(() => ({ rows: [] }));
  const byDate = new Map(forecast.rows.map((row) => [row.date, row]));
  const insights = await getPool().query(
    `select id, title, channel, status, data_basis, proposed_at::text as proposed_at
     from marketing_insights
     where center_id = $1 and status in ('proposed', 'applied')
     order by proposed_at desc limit 30;`,
    [centerId],
  ).catch(() => ({ rows: [] }));

  const ideasByDate = new Map();
  for (const row of insights.rows) {
    const basis = Array.isArray(row.data_basis) ? row.data_basis : [];
    const target = basis.map((fact) => String(fact.targetDate || fact.date || '')).find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));
    const day = target && dates.includes(target) ? target : dates[0];
    if (!ideasByDate.has(day)) ideasByDate.set(day, []);
    ideasByDate.get(day).push({ id: Number(row.id), title: row.title, channel: row.channel, status: row.status });
  }

  const days = dates.map((date) => {
    const weather = byDate.get(date) || {};
    const holidays = publicHolidaysBE(Number(date.slice(0, 4)));
    const publicHoliday = holidays.find((h) => h.date === date);
    const school = isSchoolHolidayFWB(date);
    const events = LOCAL_EVENTS
      .filter((e) => (!e.centerId || e.centerId === centerId) && date >= e.from && date <= e.to)
      .map((e) => e.label);
    return {
      date,
      tmax: weather.tmax === null || weather.tmax === undefined ? null : Number(weather.tmax),
      precipMm: weather.precip_mm === null || weather.precip_mm === undefined ? null : Number(weather.precip_mm),
      weatherCode: weather.weather_code === null || weather.weather_code === undefined ? null : Number(weather.weather_code),
      holidayLabel: publicHoliday ? publicHoliday.label : (school ? school.label : ''),
      isSchoolHoliday: Boolean(school),
      events,
      ideas: ideasByDate.get(date) || [],
    };
  });
  return { days };
}

// « Refaire » une idée qui a marché : clone d'une insight validée en nouvelle
// proposition (signature suffixée — la dédupe 7 j s'applique au clone aussi).
async function redoInsight(id) {
  const source = await getPool().query(
    'select * from marketing_insights where id = $1 limit 1;',
    [Number(id)],
  );
  const row = source.rows[0];
  if (!row) {
    const error = new Error('Idée introuvable.');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  if (row.status !== 'validated') {
    const error = new Error('Seule une idée validée (mesurée « ça a marché ») peut être relancée.');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  const signature = `${row.signature || 'idea'}-redo`;
  const recent = await getPool().query(
    `select 1 from marketing_insights
     where center_id = $1 and signature = $2 and status <> 'ignored'
       and proposed_at > now() - interval '7 days' limit 1;`,
    [row.center_id, signature],
  );
  if (recent.rows.length) {
    const error = new Error('Cette idée a déjà été relancée il y a moins de 7 jours.');
    error.statusCode = 409;
    error.expose = true;
    throw error;
  }
  const inserted = await getPool().query(
    `insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, center_id, kind, title, body, channel, ready_content, data_basis, signature, status, proposed_at;`,
    [
      row.center_id,
      row.kind || 'idea',
      `${row.title} (relance)`,
      `${row.body ? `${row.body} ` : ''}Cette idée a été mesurée « ça a marché » — on la relance.`,
      row.channel,
      row.ready_content,
      JSON.stringify(Array.isArray(row.data_basis) ? row.data_basis : []),
      signature,
    ],
  );
  const insight = inserted.rows[0];
  return { ...insight, id: Number(insight.id) };
}

module.exports = {
  // Constantes / seuils
  HEAT_THRESHOLD_C,
  STRONG_HEAT_THRESHOLD_C,
  RAIN_THRESHOLD_MM,
  SCHOOL_HOLIDAYS_FWB,
  LOCAL_EVENTS,
  // Calendrier (pur)
  easterSunday,
  publicHolidaysBE,
  isPublicHolidayBE,
  isSchoolHolidayFWB,
  nextSchoolHolidayFWB,
  upcomingLocalEvents,
  // Météo
  fetchOpenMeteoArchive,
  fetchOpenMeteoForecast,
  // Métriques
  computeMetricsFromReservations,
  buildDailyMetricsForDate,
  upsertDailyMetrics,
  collectDailyMetrics,
  listMissingMetricDates,
  refreshWeatherForecast,
  // Faits & idées (pur + orchestration)
  computeFactsFromRows,
  analyzeCenterData,
  deriveIdeaCandidates,
  makeIdeaSignature,
  renderIdeaContent,
  polishIdeaWithAi,
  buildDataFactsBundle,
  runDataIdeasCycle,
  computeInsightMeasurement,
  measureAppliedInsights,
  // Lecture / statut
  listDailyMetrics,
  listMarketingInsights,
  setInsightStatus,
  buildMarketingWeek,
  redoInsight,
};
