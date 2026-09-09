// Warehouse quotidien du centre + faits data pour l'agent marketing.
//
// Philosophie (northstar) : le LLM ne calcule JAMAIS un chiffre. Tout fait vient
// de SQL sur daily_center_metrics ; les fonctions de calcul sont PURES et testées
// (scripts/daily-metrics-check.js) ; la couche réseau (Open-Meteo) est injectable
// et non-fatale (un cron sans météo écrit quand même les métriques).
//
// Seuils Libramont (normales IRM 1981-2010) : « chaud local » >= 23 °C (au-dessus
// de la normale, fréquent), « vraiment chaud » >= 25 °C (~18 j/an), « pluie
// marquante » >= 10 mm (~39 j/an : >= 1 mm couvre 43 % des jours, trop banal).

const { getPool } = require('./database');
const { callLlmJson } = require('./llm-client');
const { simulationSqlExclusion } = require('./simulation-filter');
const { WALLONIA_SCHOOL_HOLIDAYS } = require('./booking-config');

const HEAT_THRESHOLD_C = 23;
const STRONG_HEAT_THRESHOLD_C = 25;
// LE SEUIL D'UNE IDEE N'EST PAS LE SEUIL D'UNE STATISTIQUE (2026-09-09).
// 23 et 25 ci-dessus servent a MESURER un effet de la chaleur sur la
// frequentation : a ces temperatures l'effet existe et se calcule. Mais
// PROPOSER un post « plan fraicheur » demande une chaleur que le public
// RESSENT. Trois posts ont ete proposes en production le 2026-09-04 pour 26
// degres un 7 septembre : personne ne fuit vers l'interieur a 26 degres, et le
// gerant lit une betise. Deux notions differentes, deux seuils.
const SEUIL_IDEE_CHALEUR_C = 28;
// Un « jour le plus calme » n'a de sens que si le centre a une activite a
// comparer. Sur une base vide, le pire jour et le meilleur valent zero.
const SEUIL_ACTIVITE_JOUR = 5;
const RAIN_THRESHOLD_MM = 10;
// En dessous de 90 jours de données, tout est exploratoire (méthodo R4 :
// < 3 mois = aucune conclusion ferme, 12 mois = premier signal honnête).
const EXPLORATORY_DATA_DAYS = 90;
// Minimum de jours comparables par case (ex. « samedis pluvieux ») pour émettre
// un fait : en dessous, le fait est omis plutôt que trompeur.
const MIN_SAMPLE_PER_BUCKET = 4;

// U6 : activités mesurées séparément dans pax_by_type (agrégation résas).
// 'autre' n'est pas actionnable dans un post, on ne dérive pas de fait dessus.
const ACTIVITY_BUCKETS = [
  { key: 'laser', label: 'laser game' },
  { key: 'bowling', label: 'bowling' },
  { key: 'formule', label: 'formule' },
];

const DAY_LABELS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTH_LABELS_FR = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Coordonnées par centre (Open-Meteo). Libramont = valeurs IRM/OSM.
const CENTER_COORDS = {
  libramont: { latitude: 49.92, longitude: 5.31 },
  gembloux: { latitude: 50.56, longitude: 4.69 },
};

// Événements locaux connus, datés et sourcés, utilisés comme déclencheurs
// d'idées. Foire de Libramont : dates officielles foiredelibramont.com (100e
// édition), plus grande foire agricole à ciel ouvert d'Europe, à ~5 min du centre.
const LOCAL_EVENTS = [
  { centerId: 'libramont', from: '2026-07-24', to: '2026-07-27', label: 'Foire de Libramont' },
];

// Congés scolaires FWB (RTBF + enseignement.be croisés). Rythme réforme 2022 :
// 7 semaines de cours / 2 semaines de congé (Carnaval variable).
// Les libelles accentues restent ici : ils partent dans les briefs marketing,
// la ou booking-config s ecrit sans accent. Seules les DATES viennent de la
// source d autorite.
const HOLIDAY_DISPLAY_LABELS = new Map([
  ["Conge d'automne", "Congé d'automne (Toussaint)"],
  ["Vacances d'hiver", "Vacances d'hiver (Noël)"],
  ['Conge de detente', 'Congé de détente (Carnaval)'],
  ['Vacances de printemps', 'Congé de printemps'],
  ["Vacances d'ete", "Vacances d'été"],
]);

// Conges scolaires FWB : DERIVES de lib/booking-config, jamais redeclares.
// Deux tables vivaient ici et la, decalees de 1 a 2 jours sur chaque periode
// (mesure le 2026-08-22) : un meme jour etait « en vacances » pour l agent
// marketing et « hors vacances » pour le moteur de reservation.
const SCHOOL_HOLIDAYS_FWB = WALLONIA_SCHOOL_HOLIDAYS.map((period) => {
  const base = HOLIDAY_DISPLAY_LABELS.get(period.label) || period.label;
  const year = String(period.start || '').slice(0, 4);
  return { from: period.start, to: period.end, label: period.kind === 'summer' ? `${base} ${year}` : base };
});

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
  // Warehouse quotidien = analytique : exclusion simulation en SQL. Le SELECT
  // du jour ne remonte pas la colonne channel, donc aucun filtre JS n'est
  // possible en aval : le predicat doit vivre dans la requete.
  const [dayResult, firstResult] = await Promise.all([
    runner.query(
      `select status, type, formule_id, pax, price, phone, email
       from reservations
       where center_id = $1 and date = $2 and ${simulationSqlExclusion()};`,
      [centerId, dateStr],
    ),
    runner.query(
      `
        select coalesce(nullif(trim(phone), ''), lower(trim(email))) as client_key, min(date)::text as first_date
        from reservations
        where center_id = $1
          and status <> 'cancelled'
          and coalesce(nullif(trim(phone), ''), nullif(trim(email), '')) is not null
          and ${simulationSqlExclusion()}
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
  // `key` peut être un nom de colonne OU un accesseur (U6 : lire pax_by_type[bucket]).
  const get = typeof key === 'function' ? key : (row) => row[key];
  return rows.reduce((sum, row) => sum + toNumber(get(row), 0), 0) / rows.length;
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

// U6 : lit la colonne JSON pax_by_type d'une ligne (objet pg ou string), sinon
// null. Null (colonne absente : caller sans pax_by_type) = on saute l'activité.
function bucketPaxObject(row) {
  const raw = row && row.pax_by_type;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

// U6 : effet week-end vs semaine (le contrôle jour-de-semaine de dowControlledDelta
// est dégénéré pour le week-end, qui EST une fonction du jour). `key` = accesseur.
function weekendDelta(rows, key) {
  const isWeekend = (row) => {
    const dow = dayOfWeek(row.date);
    return dow === 0 || dow === 6;
  };
  const weekend = rows.filter(isWeekend);
  const week = rows.filter((row) => !isWeekend(row));
  if (weekend.length < MIN_SAMPLE_PER_BUCKET || week.length < MIN_SAMPLE_PER_BUCKET) return null;
  const delta = pctDelta(averageOf(weekend, key), averageOf(week, key));
  if (delta === null) return null;
  return { deltaPct: delta, sampleSize: weekend.length };
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
      label: `Données encore jeunes (${dataDays} jours), tendances indicatives, pas de conclusion ferme.`,
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

  // U6 : effet météo / week-end PAR ACTIVITÉ (laser / bowling / formule) depuis
  // pax_by_type. Même mécanique contrôlée jour-de-semaine (dowControlledDelta)
  // pour pluie/chaleur, comparateur week-end direct pour le week-end. But
  // opérationnel : « ce jour-là, mets en avant le laser », 100 % grounded, zéro
  // token. Absent si aucune ligne ne porte pax_by_type (caller sans la colonne).
  if (rows.some((row) => bucketPaxObject(row) !== null)) {
    for (const bucket of ACTIVITY_BUCKETS) {
      const paxOf = (row) => {
        const obj = bucketPaxObject(row);
        return obj ? toNumber(obj[bucket.key], 0) : 0;
      };
      const bucketRain = dowControlledDelta(weatherRows, (row) => toNumber(row.weather_precip_mm, 0) >= RAIN_THRESHOLD_MM, paxOf);
      if (bucketRain) {
        facts.push({
          id: `${bucket.key}_rain_effect`,
          activity: bucket.key,
          activityLabel: bucket.label,
          label: `Les jours de vraie pluie (≥ ${RAIN_THRESHOLD_MM} mm), le ${bucket.label} fait ${bucketRain.deltaPct >= 0 ? '+' : ''}${bucketRain.deltaPct} % de participants vs jours secs comparables (sur ${bucketRain.sampleSize} jours).`,
          value: bucketRain.deltaPct,
          sampleSize: bucketRain.sampleSize,
          confidence: confidenceFor(dataDays, bucketRain.sampleSize),
        });
      }
      const bucketHeat = dowControlledDelta(weatherRows, (row) => toNumber(row.weather_tmax, -99) >= HEAT_THRESHOLD_C, paxOf);
      if (bucketHeat) {
        facts.push({
          id: `${bucket.key}_heat_effect`,
          activity: bucket.key,
          activityLabel: bucket.label,
          label: `Les jours chauds (≥ ${HEAT_THRESHOLD_C} °C), le ${bucket.label} fait ${bucketHeat.deltaPct >= 0 ? '+' : ''}${bucketHeat.deltaPct} % de participants vs jours comparables (sur ${bucketHeat.sampleSize} jours).`,
          value: bucketHeat.deltaPct,
          sampleSize: bucketHeat.sampleSize,
          confidence: confidenceFor(dataDays, bucketHeat.sampleSize),
        });
      }
      const bucketWeekend = weekendDelta(rows, paxOf);
      if (bucketWeekend) {
        facts.push({
          id: `${bucket.key}_weekend_effect`,
          activity: bucket.key,
          activityLabel: bucket.label,
          label: `Le week-end, le ${bucket.label} fait ${bucketWeekend.deltaPct >= 0 ? '+' : ''}${bucketWeekend.deltaPct} % de participants vs semaine (sur ${bucketWeekend.sampleSize} week-ends).`,
          value: bucketWeekend.deltaPct,
          sampleSize: bucketWeekend.sampleSize,
          confidence: confidenceFor(dataDays, bucketWeekend.sampleSize),
        });
      }
    }
  }

  // Saisonnalité : quel MOIS marche le mieux (+ pourquoi, grounded). Répond à
  // « quel mois fonctionne et pourquoi » : l'axe temporel qui manquait.
  const byMonth = new Map();
  for (const row of rows) {
    const month = Number(String(row.date).slice(5, 7));
    if (!month) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(row);
  }
  const monthEntries = [...byMonth.entries()]
    .filter(([, monthRows]) => monthRows.length >= 8)
    .map(([month, monthRows]) => ({
      month,
      avg: averageOf(monthRows, 'visitors'),
      sample: monthRows.length,
      holidayShare: monthRows.filter((row) => row.is_school_holiday).length / monthRows.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  if (monthEntries.length >= 3) {
    const best = monthEntries[0];
    const overallAvg = averageOf(rows, 'visitors');
    const vsAvg = overallAvg > 0 ? Math.round(((best.avg - overallAvg) / overallAvg) * 100) : 0;
    // Le « pourquoi » ne vient QUE de la donnée : part de jours en vacances
    // scolaires du mois. Jamais un driver inventé.
    const drivers = [];
    if (best.holidayShare >= 0.3) drivers.push('vacances scolaires');
    facts.push({
      id: 'best_month',
      label: `${MONTH_LABELS_FR[best.month]} est ton meilleur mois : ${Math.round(best.avg)} visiteurs/jour en moyenne, ${vsAvg >= 0 ? '+' : ''}${vsAvg} % vs ta moyenne annuelle (sur ${best.sample} jours).`,
      value: vsAvg,
      month: best.month,
      monthLabel: MONTH_LABELS_FR[best.month],
      avgVisitors: Math.round(best.avg),
      whyDrivers: drivers,
      sampleSize: best.sample,
      confidence: dataDays >= 365 ? 'solide' : (dataDays >= EXPLORATORY_DATA_DAYS ? 'signal' : 'exploratoire'),
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
      select date::text as date, visitors, revenue_total, pax_by_type, weather_tmax, weather_precip_mm, is_school_holiday
      from daily_center_metrics
      where center_id = $1 and date >= (current_date - $2::int)
      order by date asc;
    `,
    [centerId, Number(periodDays) || 365],
  );
  const rows = result.rows.map((row) => ({
    ...row,
    weather_tmax: row.weather_tmax === null ? null : toNumber(row.weather_tmax, null),
    weather_precip_mm: row.weather_precip_mm === null ? null : toNumber(row.weather_precip_mm, null),
  }));
  // Les RELEVES repartent avec les faits : dire d'une temperature qu'elle est
  // rare demande la distribution du centre, pas une opinion.
  return { ...computeFactsFromRows(rows), weatherHistory: rows };
}

// ── Idées (déclencheurs déterministes → contenu prêt à poster) ───────────────

// Date ISO -> jj/mm lisible (les phrases de l'agent ne montrent JAMAIS d'ISO).
function frShortIso(dateStr) {
  return `${String(dateStr).slice(8, 10)}/${String(dateStr).slice(5, 7)}`;
}

// La signature porte le JOUR VISE quand l'idee en a un (refonte lifecycle
// 17/07, retour Movsar) : sans lui, « rain_forecast:facebook » du 16 bloquait
// par dedupe 7 jours toute idee pluie pour les jours suivants, pendant que la
// perimee restait affichee. Une idee structurelle (jour creux) reste sans date.
function makeIdeaSignature(trigger, channel, targetDate = '') {
  return targetDate ? `${trigger}:${channel}:${targetDate}` : `${trigger}:${channel}`;
}

// Renders : templates SANS aucun chiffre inventé, uniquement les valeurs des
// déclencheurs (météo prévue, dates, moyennes des facts). Aucune promo chiffrée
// n'est promise (forbiddenClaims marketing : pas de « réduction garantie ») 
// l'offre exacte reste la décision du gérant, l'idée la suggère sans l'annoncer.
function renderIdeaContent(candidate) {
  if (candidate.trigger === 'rain_forecast') {
    // U4 : sans effet pluie confirmé, on retire la promesse d'afflux
    // (« réserve avant tout le monde ») et on garde une accroche neutre.
    return candidate.grounded === false
      ? `Pluie annoncée ${candidate.dayLabel} (${candidate.precipMm} mm) ? Zéro goutte chez nous : bowling, laser game et arcades bien au sec. Le plan parfait quand il tombe des cordes.`
      : `Pluie annoncée ${candidate.dayLabel} (${candidate.precipMm} mm) ? Zéro goutte chez nous : bowling, laser game et arcades bien au sec. Pense à réserver ta piste avant que tout le monde ait la même idée.`;
  }
  if (candidate.trigger === 'heat_forecast') {
    return `${candidate.tmax}° annoncés ${candidate.dayLabel} : chez nous il fait frais toute la journée. Bowling, laser game, arcades : le plan fraîcheur à 5 minutes.`;
  }
  if (candidate.trigger === 'school_holiday') {
    // U4 : sans effet congés confirmé, on retire l'urgence (« réserve
    // maintenant, les vacances partent vite ») au profit d'une invitation neutre.
    return candidate.grounded === false
      ? `${candidate.holidayLabel} : c'est le ${candidate.startLabel} que ça commence. Anniversaires, sorties en famille, après-midis entre amis, pensez à nous pour occuper les enfants.`
      : `${candidate.holidayLabel} : c'est le ${candidate.startLabel} que ça commence. Anniversaires, sorties en famille, après-midis entre amis, réserve ton créneau maintenant, les vacances partent vite.`;
  }
  if (candidate.trigger === 'local_event') {
    return `${candidate.eventLabel} (${candidate.eventDates}) : on est à 5 minutes. Avant ou après votre visite, pause bowling, laser game ou arcades, au calme et au frais.`;
  }
  if (candidate.trigger === 'quiet_day') {
    return `Idée interne : le ${candidate.dayLabel} est ton jour le plus calme (${candidate.avgVisitors} visiteurs en moyenne, sur ${candidate.sampleSize} ${candidate.dayLabel}s). Une offre spéciale ${candidate.dayLabel} hors vacances (école, seniors, afterwork) peut remplir ce creux.`;
  }
  return candidate.title || '';
}

// U4 : un candidat météo / vacances ne PROMET un afflux que si la donnée du
// centre le CONFIRME (fait mesuré, non exploratoire, effet positif). Sinon on
// dégrade la formulation en hypothèse à tester : jamais une promesse inventée.
function measuredEffect(facts, id) {
  const fact = (facts || []).find((item) => item.id === id) || null;
  const grounded = Boolean(fact) && fact.confidence !== 'exploratoire' && toNumber(fact.value, 0) > 0;
  return { grounded, fact };
}

// U6 : quelle activité sur-performe dans ce contexte (fait mesuré, positif, non
// exploratoire) ? Sert à souffler au gérant « mets en avant le laser ce jour-là »
// un NOM d'activité, aucun chiffre : le garde-fou anti-invention reste intact.
function topActivityEffect(facts, suffix) {
  return (facts || [])
    .filter((item) => typeof item.id === 'string' && item.id.endsWith(suffix)
      && item.activityLabel // exclut les faits centre-entier (ex. strong_heat_effect) sans activité
      && item.confidence !== 'exploratoire' && toNumber(item.value, 0) > 0)
    .sort((a, b) => toNumber(b.value, 0) - toNumber(a.value, 0))[0] || null;
}

// Dérive les candidats d'idées depuis prévision + calendrier + facts. PURE
// (le `today` est injecté). Priorité : météo (actionnable J+2/J+3, pattern
// « anticiper sur prévision ») > événement local > vacances > jour creux.
// `limit` : nombre de candidats retournés (défaut 3). runDataIdeasCycle passe
// Infinity pour scorer TOUS les candidats par valeur apprise AVANT de tronquer.
// « RARE PAR ICI » EST UNE AFFIRMATION SUR UN CLIMAT : ELLE SE CALCULE.
// Elle etait ecrite EN DUR dans les deux branches du gabarit, mesuree ou non.
// On la remplace par la part reelle des jours de l'historique du centre qui
// atteignent cette temperature. Sans historique suffisant, on ne dit rien :
// l'agent n'a pas le droit d'avoir un avis sur un climat qu'il n'a pas releve.
const MIN_JOURS_POUR_JUGER_LE_CLIMAT = 30;
const PART_MAX_POUR_DIRE_RARE = 15;
function rareteChaleur(weatherHistory, tmax) {
  const releves = (weatherHistory || [])
    .map((row) => toNumber(row && (row.weather_tmax !== undefined ? row.weather_tmax : row.tmax), NaN))
    .filter((value) => Number.isFinite(value));
  if (releves.length < MIN_JOURS_POUR_JUGER_LE_CLIMAT) return { prouvee: false, partPct: null, echantillon: releves.length };
  const seuil = toNumber(tmax, 0);
  const atteints = releves.filter((value) => value >= seuil).length;
  const partPct = Math.round((atteints / releves.length) * 100);
  return { prouvee: partPct <= PART_MAX_POUR_DIRE_RARE, partPct, echantillon: releves.length };
}

function deriveIdeaCandidates({ today, forecast = [], facts = [], nextHoliday = null, localEvents = [], weatherHistory = [], limit = 3 } = {}) {
  const candidates = [];

  // Météo J+2 / J+3 (fenêtre d'anticipation documentée : poster 2-3 j avant).
  for (const offset of [2, 3]) {
    const target = addDaysIso(today, offset);
    const day = forecast.find((row) => row.date === target);
    if (!day) continue;
    const dayLabel = DAY_LABELS_FR[dayOfWeek(target)];
    if (toNumber(day.precipMm, 0) >= RAIN_THRESHOLD_MM) {
      const mm = Math.round(toNumber(day.precipMm, 0));
      const effect = measuredEffect(facts, 'rain_effect');
      const topActivity = topActivityEffect(facts, '_rain_effect');
      const hint = topActivity ? ` Sur tes jours de pluie, c'est le ${topActivity.activityLabel} qui sur-performe : mets-le en avant.` : '';
      candidates.push({
        trigger: 'rain_forecast',
        channel: 'facebook',
        kind: 'idea',
        grounded: effect.grounded,
        targetDate: target,
        title: `Post « plan pluie » pour ${dayLabel} ${frShortIso(target)}`,
        why: (effect.grounded
          ? `${mm} mm de pluie annoncés ${dayLabel} ${frShortIso(target)} : chez toi, les jours de vraie pluie remplissent (c'est mesuré). Poste 2-3 jours avant, pas le jour même.`
          : `${mm} mm de pluie annoncés ${dayLabel} ${frShortIso(target)} : effet pluie pas encore confirmé par tes chiffres, à tester. Poste 2-3 jours avant et on mesurera.`) + hint,
        dayLabel: `${dayLabel} ${target.slice(8, 10)}/${target.slice(5, 7)}`,
        precipMm: mm,
        dataBasis: [{ source: 'weather_daily_forecast', date: target, precipMm: day.precipMm }],
      });
      break;
    }
    if (toNumber(day.tmax, -99) >= SEUIL_IDEE_CHALEUR_C) {
      const tmaxRound = Math.round(toNumber(day.tmax, 0));
      const effect = measuredEffect(facts, 'heat_effect');
      const topActivity = topActivityEffect(facts, '_heat_effect');
      const rarete = rareteChaleur(weatherHistory, day.tmax);
      const mentionRarete = rarete.prouvee ? `, ça n'arrive que ${rarete.partPct} % des jours ici` : '';
      const hint = topActivity ? ` Sur tes jours chauds, c'est le ${topActivity.activityLabel} qui sur-performe : mets-le en avant.` : '';
      candidates.push({
        trigger: 'heat_forecast',
        channel: 'facebook',
        kind: 'idea',
        grounded: effect.grounded,
        targetDate: target,
        title: `Post « plan fraîcheur » pour ${dayLabel} ${frShortIso(target)}`,
        why: (effect.grounded
          ? `${tmaxRound} °C annoncés ${dayLabel} ${frShortIso(target)}${mentionRarete} : chez toi les jours chauds remplissent (c'est mesuré). Le plan fraîcheur se poste 2-3 jours avant.`
          : `${tmaxRound} °C annoncés ${dayLabel} ${frShortIso(target)}${mentionRarete}. Le plan fraîcheur se poste 2-3 jours avant ; on mesurera si ça a rempli.`) + hint,
        dayLabel: `${dayLabel} ${target.slice(8, 10)}/${target.slice(5, 7)}`,
        tmax: tmaxRound,
        dataBasis: rarete.prouvee
          ? [{ source: 'weather_daily_forecast', date: target, tmax: day.tmax },
            { source: 'weather_history', partPct: rarete.partPct, sampleSize: rarete.echantillon, seuilC: tmaxRound }]
          : [{ source: 'weather_daily_forecast', date: target, tmax: day.tmax }],
      });
      break;
    }
  }

  // Événement local à ≤ 14 jours (ex. Foire de Libramont : afflux à 5 min).
  const event = localEvents.find((item) => item.from <= addDaysIso(today, 14));
  if (event) {
    candidates.push({
      trigger: 'local_event',
      channel: 'facebook',
      kind: 'idea',
      targetDate: event.to,
      title: `Post « ${event.label} »`,
      why: `${event.label} du ${frShortIso(event.from)} au ${frShortIso(event.to)} : des milliers de familles à 5 minutes du centre. Un post juste avant les attrape au bon moment.`,
      eventLabel: event.label,
      eventDates: `du ${event.from.slice(8, 10)}/${event.from.slice(5, 7)} au ${event.to.slice(8, 10)}/${event.to.slice(5, 7)}`,
      dataBasis: [{ source: 'local_events', from: event.from, to: event.to, label: event.label }],
    });
  }

  // Congé scolaire FWB qui démarre à ≤ 14 jours.
  if (nextHoliday && nextHoliday.from <= addDaysIso(today, 14) && nextHoliday.from >= today) {
    const effect = measuredEffect(facts, 'school_holiday_effect');
    candidates.push({
      trigger: 'school_holiday',
      channel: 'facebook',
      kind: 'idea',
      grounded: effect.grounded,
      targetDate: nextHoliday.from,
      title: `Post « ${nextHoliday.label} »`,
      why: effect.grounded
        ? `${nextHoliday.label} commence le ${frShortIso(nextHoliday.from)} : chez toi les congés scolaires remplissent (c'est mesuré), c'est maintenant que les familles réservent.`
        : `${nextHoliday.label} commence le ${frShortIso(nextHoliday.from)} : effet congés pas encore confirmé par tes chiffres, mais c'est la période où les familles planifient. On teste et on mesurera.`,
      holidayLabel: nextHoliday.label,
      startLabel: `${nextHoliday.from.slice(8, 10)}/${nextHoliday.from.slice(5, 7)}`,
      dataBasis: [{ source: 'school_holidays_fwb', from: nextHoliday.from, to: nextHoliday.to }],
    });
  }

  // Jour creux récurrent : UNIQUEMENT mardi (2) ou jeudi (4) : le mercredi
  // après-midi belge n'est PAS un creux (les enfants n'ont pas cours).
  const worst = facts.find((fact) => fact.id === 'dow_worst');
  // UN PIRE JOUR NE VEUT RIEN DIRE SANS MEILLEUR JOUR. Releve en production le
  // 2026-09-03 sur Gembloux : « ton jour le plus calme : 0 visiteurs en moyenne
  // (sur 6 mardis) », avec une campagne email redigee dessus. L'echantillon
  // passait le filtre, mais le centre n'avait aucune reservation dans l'outil :
  // l'agent lisait une base vide comme un fait commercial.
  const best = facts.find((fact) => fact.id === 'dow_best');
  const centreActif = Boolean(best) && toNumber(best.value, 0) >= SEUIL_ACTIVITE_JOUR;
  if (worst && [2, 4].includes(worst.dow) && centreActif) {
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

  return candidates.slice(0, limit).map((candidate) => ({
    ...candidate,
    signature: makeIdeaSignature(candidate.trigger, candidate.channel, candidate.targetDate || ''),
    readyContent: renderIdeaContent(candidate),
  }));
}

// Amélioration OPTIONNELLE du texte par IA (Claude prioritaire, OpenAI sinon 
// gated par la clé, fallback template silencieux). GROUNDING DUR : le modèle
// reformule, il n'a pas le droit d'ajouter un chiffre, une promo ou une
// activité absente des faits fournis : et on rejette sa sortie si un nombre
// inconnu apparaît.
// UN NOM PROPRE INVENTE EST UN MENSONGE LOCAL, ET IL SE VOIT.
// Releve en production le 2026-09-04 : le post de LIBRAMONT portait « #Namur ».
// Libramont est en province de Luxembourg, Namur est celle de Gembloux. La
// cause n'etait pas le modele : la consigne Facebook lui demande « 0 a 2
// hashtags en fin, du type nom du lieu et ville », et la ville ne lui etait
// JAMAIS donnee. On lui donne donc la ville (il n'a plus a deviner), et on
// verifie sa sortie : le controle d'ancrage ne regardait que les CHIFFRES, si
// bien qu'un lieu, une enseigne ou une offre inventes passaient librement.
function sansAccent(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function nomsPropresNonAncres(content, allowed) {
  const socle = sansAccent(allowed);
  const suspects = [];
  for (const etiquette of String(content).match(/[#@][\p{L}\p{N}_-]{2,}/gu) || []) {
    if (!socle.includes(sansAccent(etiquette.slice(1)))) suspects.push(etiquette);
  }
  // Le PREMIER mot d'une phrase est majuscule par grammaire : on ne le juge
  // pas. Ceux du milieu, si.
  for (const phrase of String(content).split(/[.!?\n]+/)) {
    for (const brut of phrase.trim().split(/\s+/).slice(1)) {
      const mot = brut.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!/^\p{Lu}[\p{L}'-]{2,}$/u.test(mot)) continue;
      if (!socle.includes(sansAccent(mot))) suspects.push(mot);
    }
  }
  return suspects;
}

// PLUS SUR LE CHEMIN DES IDEES depuis le passage a lib/center-advisor.js : le
// texte publie ne vient plus d'un gabarit reformule mais de la fiche de faits
// complete. Cette fonction reste ici parce que son garde-fou anti-invention est
// la doctrine que copient lib/email-agent.js et lib/marketing-brain.js, et que
// le gate daily-metrics-check en prouve le fonctionnement. Ne pas la rebrancher
// sur la generation d'idees : c'est elle qui produisait 39 "plan fraicheur" sur
// 67, faute de pouvoir dire autre chose que la phrase qu'on lui donnait.
async function polishIdeaWithAi(candidate, { fetchImpl = fetch, centerFacts = null } = {}) {
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
      // La consigne du canal reclame « nom du lieu et ville » : sans cette
      // donnee le modele DEVINE, et il s'est deja trompe de province.
      lieu: centerFacts ? { nom: centerFacts.centerName || '', ville: centerFacts.city || '' } : undefined,
      rappel: `${COPY_FINAL_REMINDER} CONTRAINTE DURE : ta réécriture ne contient QUE des nombres déjà présents dans baseContent ou facts, AUCUN autre, pas même ceux de l'exemple canonique (ils appartiennent à un autre centre). Si tu veux dire que c'est rapide, dis-le sans chiffre.`,
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
  const allowed = `${candidate.readyContent} ${JSON.stringify(candidate.dataBasis)} ${candidate.why || ''}`
    + ` ${(centerFacts && centerFacts.centerName) || ''} ${(centerFacts && centerFacts.city) || ''}`;
  const numbers = content.match(/\d+(?:[.,]\d+)?/g) || [];
  for (const number of numbers) {
    const canonical = number.replace(',', '.');
    if (!allowed.includes(number) && !allowed.includes(canonical)) return null;
  }
  if (nomsPropresNonAncres(content, allowed).length) return null;
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
  // due_date = le jour vise : c'est ELLE qui fait vivre puis mourir l'idee
  // (peremption serveur + filtre d'affichage). Une idee sans date (offre
  // structurelle) vit 10 jours max via l'expiration d'age.
  await pool.query(
    `
      insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature, due_date, payload)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb);
    `,
    [centerId, idea.kind || 'idea', idea.title, idea.why || '', idea.channel, idea.readyContent, JSON.stringify(idea.dataBasis || []), idea.signature, idea.targetDate || null,
      // QUI A ECRIT CE TEXTE. C'est ce champ que la mesure J+14 croisera avec
      // l'effet reel sur la frequentation : sans lui, on saurait qu'une idee a
      // marche, jamais si c'est le modele ou le gabarit qui l'a ecrite.
      JSON.stringify({ auteur: idea.auteur === 'ai' ? 'ai' : 'rules' })],
  );
  return { inserted: true };
}

// PEREMPTION (refonte lifecycle 17/07) : une idee datee meurt a la fin de son
// jour vise, une idee sans date meurt a 10 jours. Sans ca, « Post plan
// fraicheur pour jeudi 16/07 » restait affiche le 17 (vu en prod par Movsar),
// et rien dans tout le systeme ne fermait jamais une proposition. Le statut
// est 'ignored' (pas de mesure J+14 : rien n'a ete publie) et le dedupe
// exclut les ignored : une nouvelle idee datee peut naitre immediatement.
async function expireStaleInsights(centerId, today) {
  const result = await getPool().query(
    `
      update marketing_insights
      set status = 'ignored'
      where center_id = $1 and status = 'proposed'
        and (
          (due_date is not null and due_date < $2::date)
          or proposed_at < now() - interval '10 days'
        )
      returning id;
    `,
    [centerId, today],
  ).catch(() => ({ rows: [] }));
  return { expired: result.rows.length };
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
    weatherHistory: analysis.weatherHistory || [],
  };
}

// Cycle idées : péremption → déclencheurs → 0-3 idées → polish IA optionnel
// → insert dédupé. La péremption passe D'ABORD : le matin nettoie les idées
// mortes avant d'en créer de fraîches.
// La ville et le nom du centre, lus a la demande : require en ligne pour ne pas
// creer de cycle entre ce module et celui des agents marketing.
function faitsDuCentre(centerId) {
  try {
    const { buildCenterFacts } = require('./marketing-agents');
    return buildCenterFacts(centerId);
  } catch (error) {
    return null;
  }
}

async function runDataIdeasCycle({ centerId = 'libramont', bundle = null, fetchImpl = fetch } = {}) {
  const dataBundle = bundle || await buildDataFactsBundle(centerId, { fetchImpl });
  await expireStaleInsights(centerId, dataBundle.today);
  // U5 : générer TOUS les candidats éligibles (limit: Infinity), les scorer par
  // valeur apprise, PUIS tronquer aux 3 meilleurs. Avant, deriveIdeaCandidates
  // tronquait à 3 AVANT le scoring : un candidat à forte valeur apprise (ex.
  // jour creux qui convertit) pouvait être coupé d'office par la priorité fixe.
  let candidates = deriveIdeaCandidates({
    today: dataBundle.today,
    forecast: dataBundle.forecast7,
    facts: dataBundle.facts,
    nextHoliday: dataBundle.nextSchoolHoliday,
    localEvents: dataBundle.localEvents,
    weatherHistory: dataBundle.weatherHistory || [],
    limit: Infinity,
  });
  // Réinjection (G3) : priorise les candidats par ce qui a PROUVÉ sa valeur chez
  // ce centre (effet net mesuré). Déterministe, fail-soft (ordre par défaut si
  // la mémoire est vide ou indisponible).
  try {
    const patterns = await listMarketingPatterns(centerId, { limit: 50 });
    if (patterns.length) {
      const map = new Map(patterns.map((p) => [p.contextKey, { avgNetDelta: p.netDeltaPct, avgRawDelta: p.rawDeltaPct }]));
      candidates = rankCandidatesByPatterns(candidates, map);
    }
  } catch (error) { /* ordre par défaut */ }
  candidates = candidates.slice(0, 3); // U5 : troncature APRÈS le scoring par valeur apprise

  // ── LE CONSEIL ANCRE, SANS GABARIT ────────────────────────────────────────
  // Les candidats ci-dessus ne servent plus qu'a une chose : dire QUELS jours
  // sont dignes d'attention (declencheurs meteo / calendrier). Leur PHRASE
  // n'est plus utilisee. Le texte vient de proposerDepuisLaFiche, qui recoit
  // la fiche complete du registre plus l'horizon, et choisit lui-meme quoi
  // dire. Aucune phrase preecrite ne sort d'ici.
  const lieu = faitsDuCentre(centerId);
  const results = [];
  let conseil = null;
  try {
    const {
      chargerFicheDuRegistre, ajouterHorizon, ajouterIdentite, ajouterMemoire, chargerMemoireDuCentre,
    } = require('./center-facts');
    // La memoire est fail-soft comme la doctrine : un agent sans memoire dit
    // peut-etre deux fois la meme chose, un agent qui plante ne dit rien.
    const historique = await chargerMemoireDuCentre({ centerId }).catch(() => []);
    const { proposerDepuisLaFiche } = require('./center-advisor');
    // LA DOCTRINE D ECRITURE, pas des faits. buildDnaBlock rend deja une chaine
    // vide quand la DB est absente ou la table vide : l ADN enrichit le style,
    // il ne conditionne jamais la generation. Le .catch garde ce contrat meme
    // si le module change d avis un jour.
    const { buildDnaBlock } = require('./marketing-dna');
    const doctrine = await buildDnaBlock('facebook', {}).catch(() => '');
    // L identite du centre AVANT l horizon : ce que le centre EST ne depend pas
    // de la meteo de la semaine. Sans elle, le modele voyait « laser 500 m2 »
    // dans son prompt et se faisait jeter s il l ecrivait.
    const fiche = ajouterHorizon(
      ajouterMemoire(
        ajouterIdentite(await chargerFicheDuRegistre({ centerId, aujourdhui: dataBundle.today }), lieu),
        historique,
      ),
      {
        today: dataBundle.today,
        forecast: dataBundle.forecast7 || [],
        nextHoliday: dataBundle.nextSchoolHoliday,
        localEvents: dataBundle.localEvents || [],
      },
    );
    const rendu = await proposerDepuisLaFiche({
      fiche,
      lieu: { nom: (lieu && lieu.centerName) || '', ville: (lieu && lieu.city) || '' },
      // L IDENTITE COMPLETE, pas seulement le nom : activites reelles, themes
      // et revendications interdites. Sans elle le modele sait combien on a
      // vendu mais pas ce qu on vend, et rien n empeche un post Golf o Clock
      // sur un centre qui n en a pas.
      centerFacts: lieu,
      doctrine,
      historique,
      aujourdhui: dataBundle.today,
      fetchImpl,
    });
    conseil = rendu;
    // LA PISTE, quand le refus en a ouvert une. Genre distinct et AUCUN
    // contenu pret a coller : la console rend toute ligne proposee comme un
    // texte a publier, et une question a trancher n en est pas un. Sa
    // signature porte le sujet, donc le meme sujet ne revient pas chaque jour.
    if (rendu.piste) {
      const piste = {
        kind: 'piste',
        channel: null,
        title: `A trancher : ${rendu.piste.sujet}`,
        why: [
          rendu.piste.populationARisque ? `concerne ${rendu.piste.populationARisque}` : null,
          rendu.piste.chiffreARisque ? `en jeu ${rendu.piste.chiffreARisque}` : null,
          rendu.piste.comparaisonDisponible || null,
        ].filter(Boolean).join(' | '),
        readyContent: null,
        dataBasis: [],
        signature: makeIdeaSignature('piste', rendu.piste.sujet, ''),
        targetDate: null,
        auteur: 'rules',
      };
      const posee = await insertIdeaIfNew(centerId, piste);
      results.push({ ...piste, inserted: posee.inserted, reason: posee.reason || '' });
    }
    if (rendu.proposition) {
      const idee = {
        kind: 'idea',
        channel: 'facebook',
        title: rendu.proposition.titre,
        why: `faits : ${rendu.proposition.faitsUtilises.join(', ')}`,
        readyContent: rendu.proposition.corps,
        // La tracabilite EST la garantie : chaque fait cite se rejoue a la main
        // depuis son champ `source`. Un conseil dont on ne peut pas refaire le
        // calcul n'a rien a faire dans la console d'un gerant.
        dataBasis: rendu.proposition.faitsUtilises.map((id) => ({
          factId: id,
          valeur: fiche[id] && fiche[id].valeur,
          observations: fiche[id] && fiche[id].n,
          calcul: fiche[id] && fiche[id].source,
        })),
        signature: makeIdeaSignature('fiche', rendu.proposition.nature, dataBundle.today),
        targetDate: null,
        auteur: 'ai',
      };
      const outcome = await insertIdeaIfNew(centerId, idee);
      results.push({ signature: idee.signature, title: idee.title, ...outcome });
    }
  } catch (error) {
    // Fail-soft : un conseil manquant vaut mieux qu'un cycle qui casse. Le
    // motif est trace, jamais avale en silence.
    conseil = { proposition: null, motifs: [`erreur : ${error && error.message}`] };
  }
  return {
    ok: true,
    centerId,
    candidates: candidates.length,
    results,
    // La piste remonte a cote du verdict : un refus qui ouvre une question vaut
    // mieux qu un refus muet, et elle reste du cote gerant, jamais publiee.
    conseil: conseil ? {
      retenu: Boolean(conseil.proposition),
      // La CAUSE du silence, pas seulement son constat : une cle absente et un
      // centre sans matiere produisent le meme ecran vide, et ce ne sont pas du
      // tout les memes problemes.
      silence: conseil.silence || null,
      motifs: conseil.motifs || [],
      piste: conseil.piste || null,
    } : null,
  };
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
    // l'autre, la comparaison ne mesure pas l'idée, on saute ce jour.
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

// ── Effet NET vs baseline (contrefactuel) : G1 de la boucle d'apprentissage ──
// Chaque row porte `expected` = visiteurs attendus par le modèle (jour-de-semaine
// × vacances × météo apprise, cf. buildBaselines/learnedWeatherEffect du cerveau).
// Effet net d'une action = résidu moyen APRÈS − résidu moyen AVANT, le résidu
// étant l'écart RELATIF à la baseline. Retire les confondeurs que le cerveau
// connaît DÉJÀ (un post un jour de pluie n'est plus crédité du +X % météo) : là
// où la mesure brute laissait ces effets polluer le verdict. PUR, testable.
function residualPct(row) {
  const expected = toNumber(row.expected, 0);
  if (expected <= 0) return null;
  return ((toNumber(row.visitors, 0) - expected) / expected) * 100;
}

function computeNetInsightMeasurement({ before = [], after = [] } = {}) {
  const residuals = (rows) => rows.map(residualPct).filter((value) => value !== null);
  const beforeResiduals = residuals(before);
  const afterResiduals = residuals(after);
  if (beforeResiduals.length < MIN_SAMPLE_PER_BUCKET || afterResiduals.length < MIN_SAMPLE_PER_BUCKET) {
    return { netDeltaPct: null, netSampleDays: Math.min(beforeResiduals.length, afterResiduals.length) };
  }
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  return {
    netDeltaPct: Math.round(mean(afterResiduals) - mean(beforeResiduals)),
    netSampleDays: Math.min(beforeResiduals.length, afterResiduals.length),
  };
}

// ── Mémoire par contexte (G2) : agrège l'effet mesuré par (kind|channel|trigger).
// Le trigger vient de la SIGNATURE (vocab brut rain_forecast/quiet_day/…) pour
// s'aligner exactement sur ce que produit deriveIdeaCandidates → la réinjection
// (G3) matche le bon contexte. PUR, testable sans DB. ──
function signatureTrigger(signature = '') {
  const head = String(signature || '').split(':')[0];
  return head || 'plan';
}

function patternContextKey({ kind = 'post', channel = '', trigger = '' } = {}) {
  return `${kind || 'post'}|${channel || ''}|${trigger || 'plan'}`;
}

function patternConfidence(sampleCount) {
  if (sampleCount >= 6) return 'solide';
  if (sampleCount >= 3) return 'signal';
  return 'exploratoire';
}

// U8 : `revenueByTrigger` = Map/objet { trigger -> { revenue, conversions, sent } }
// issu de la taxonomie MARKETING_SOURCES (marketing-roi), rattaché au pattern par
// son trigger (context_key = kind|channel|TRIGGER). Le revenu attribué (€) enrichit
// et pondère le pattern EN PLUS de l'effet visiteurs net. Défaut {} = comportement
// inchangé (pur, testable sans ROI).
function buildPatternRows(insights = [], revenueByTrigger = {}) {
  const groups = new Map();
  for (const insight of insights) {
    const payload = insight.payload || {};
    const channel = insight.channel || payload.network || '';
    const kind = payload.kind || (channel === 'email' ? 'email' : 'post');
    const trigger = payload.trigger || signatureTrigger(insight.signature);
    const key = patternContextKey({ kind, channel, trigger });
    if (!groups.has(key)) groups.set(key, { context_key: key, kind, channel, trigger, nets: [], raws: [], wins: 0 });
    const group = groups.get(key);
    const result = insight.result || {};
    if (result.netDeltaPct !== null && result.netDeltaPct !== undefined) group.nets.push(Number(result.netDeltaPct));
    if (result.deltaPct !== null && result.deltaPct !== undefined) group.raws.push(Number(result.deltaPct));
    if (insight.status === 'validated') group.wins += 1;
  }
  const mean = (list) => (list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null);
  const revenueOf = (trigger) => {
    const source = (revenueByTrigger instanceof Map ? revenueByTrigger.get(trigger) : revenueByTrigger[trigger]) || null;
    return source;
  };
  return [...groups.values()].map((group) => {
    const sampleCount = group.nets.length || group.raws.length;
    const attributed = revenueOf(group.trigger);
    return {
      context_key: group.context_key,
      kind: group.kind,
      channel: group.channel,
      trigger: group.trigger,
      avgNetDelta: mean(group.nets),
      avgRawDelta: mean(group.raws),
      // U8 : euros attribués (last-touch) à cette source marketing, null si le
      // trigger n'a pas d'équivalent dans la taxonomie MARKETING_SOURCES.
      revenue: attributed ? Number(attributed.revenue) || 0 : null,
      attributedConversions: attributed ? Number(attributed.conversions) || 0 : null,
      n: sampleCount,
      wins: group.wins,
      confidence: patternConfidence(sampleCount),
    };
  }).sort((a, b) => {
    const deltaA = a.avgNetDelta ?? a.avgRawDelta ?? -999;
    const deltaB = b.avgNetDelta ?? b.avgRawDelta ?? -999;
    if (deltaB !== deltaA) return deltaB - deltaA;
    // U8 : à effet visiteurs égal, le pattern qui rapporte le plus d'euros passe devant.
    return (b.revenue ?? -1) - (a.revenue ?? -1);
  });
}

// ── Réinjection déterministe (G3) : priorise les candidats d'idées par ce qui a
// prouvé sa valeur chez ce centre (aucun appel LLM, zéro token). patternMap :
// Map context_key -> pattern. Attache `learnedPattern` au candidat priorisé. ──
function rankCandidatesByPatterns(candidates = [], patternMap = new Map()) {
  const patternFor = (candidate) => patternMap.get(patternContextKey({
    kind: candidate.channel === 'email' ? 'email' : 'post',
    channel: candidate.channel,
    trigger: candidate.trigger,
  })) || null;
  return candidates
    .map((candidate, index) => {
      const pattern = patternFor(candidate);
      const delta = pattern ? (pattern.avgNetDelta ?? pattern.avgRawDelta) : null;
      return { candidate, index, pattern, score: delta === null || delta === undefined ? 0 : delta };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(({ candidate, pattern }) => (pattern ? { ...candidate, learnedPattern: pattern } : candidate));
}

// Mesure les idées appliquées depuis >= 14 jours et pas encore mesurées.
// Stocke DEUX chiffres : brut (verdict historique, inchangé) ET net (effet vs
// baseline, G1). Le verdict reste piloté par le brut, on n'altère pas le
// moteur de crédibilité, on l'enrichit.
async function measureAppliedInsights({ centerId = 'libramont' } = {}) {
  const pool = getPool();
  const pending = await pool.query(
    `
      select id, applied_at::date::text as applied_date, payload
      from marketing_insights
      where center_id = $1 and status = 'applied'
        and applied_at <= now() - interval '14 days'
        and measured_at is null
      limit 10;
    `,
    [centerId],
  );
  if (!pending.rows.length) return { ok: true, centerId, measured: [] };

  // Prédicteur baseline (jour × vacances × météo apprise) = le contrefactuel de
  // l'effet net. Reuse du cerveau via require PARESSEUX (évite le cycle au
  // chargement : marketing-brain require center-metrics). Fail-soft : sans
  // prédicteur, l'effet net reste null et le brut prend le relais.
  let expectedFor = () => 0;
  try {
    const { buildBaselines, learnedWeatherEffect } = require('./marketing-brain');
    const histResult = await pool.query(
      `select date::text as date, visitors, weather_tmax, weather_precip_mm, is_school_holiday, is_public_holiday
       from daily_center_metrics where center_id = $1 and date >= (current_date - 365) order by date asc;`,
      [centerId],
    );
    const history = histResult.rows.map((r) => ({
      ...r,
      visitors: toNumber(r.visitors, 0),
      weather_tmax: r.weather_tmax === null ? null : toNumber(r.weather_tmax, null),
      weather_precip_mm: r.weather_precip_mm === null ? null : toNumber(r.weather_precip_mm, null),
    }));
    const baselines = buildBaselines(history);
    const { facts } = computeFactsFromRows(history);
    expectedFor = (row) => {
      const dow = dayOfWeek(row.date);
      const holiday = Boolean(row.is_school_holiday) || Boolean(row.is_public_holiday);
      let value = baselines.lookup(dow, holiday).value;
      const effect = learnedWeatherEffect(facts, {
        precipMm: row.weather_precip_mm === undefined ? null : row.weather_precip_mm,
        tmax: row.weather_tmax === undefined ? null : row.weather_tmax,
      });
      if (effect) value *= 1 + effect.deltaPct / 100;
      return Math.max(0, value);
    };
  } catch (error) {
    expectedFor = () => 0;
  }

  const measured = [];
  for (const row of pending.rows) {
    const appliedDate = row.applied_date;
    const windowResult = await pool.query(
      `
        select date::text as date, visitors, revenue_total, is_school_holiday, weather_tmax, weather_precip_mm
        from daily_center_metrics
        where center_id = $1 and date >= $2::date - 14 and date <= $2::date + 14 and date <> $2::date;
      `,
      [centerId, appliedDate],
    );
    const withExpected = windowResult.rows.map((item) => ({ ...item, expected: expectedFor(item) }));
    const before = withExpected.filter((item) => item.date < appliedDate);
    const after = withExpected.filter((item) => item.date > appliedDate);
    const raw = computeInsightMeasurement({ before, after });
    const net = computeNetInsightMeasurement({ before, after });
    const measurement = { ...raw, ...net };
    await pool.query(
      `
        update marketing_insights
        set status = $2, result = $3, measured_at = now()
        where id = $1;
      `,
      [row.id, measurement.verdict, JSON.stringify(measurement)],
    );
    // Bandit d'angles : récompense l'angle testé depuis la mesure réelle (effet
    // net > 0 = succès). Non-fatal, ne concerne que les propositions taguées.
    const angleKey = row.payload && row.payload.angle;
    if (angleKey) {
      const won = typeof measurement.netDeltaPct === 'number' ? measurement.netDeltaPct > 0 : measurement.verdict === 'validated';
      await require('./marketing-bandit').recordAngleOutcome(centerId, angleKey, won).catch(() => null);
    }
    measured.push({ id: Number(row.id), ...measurement });
  }
  return { ok: true, centerId, measured };
}

// Agrège l'effet mesuré par contexte dans marketing_patterns (G2). Idempotent :
// recalcul complet + upsert par context_key. Tourne au cron APRÈS
// measureAppliedInsights. Aucun LLM, zéro token.
async function aggregateMarketingPatterns({ centerId = 'libramont' } = {}) {
  const pool = getPool();
  const result = await pool.query(
    `select signature, channel, kind, payload, result, status
     from marketing_insights
     where center_id = $1 and status in ('validated', 'refuted', 'inconclusive') and result is not null;`,
    [centerId],
  );
  // U8 : euros attribués par source marketing (last-touch, fenêtre large),
  // raccordés au pattern via son trigger. Pur SQL, zéro appel LLM (coût IA nul).
  // require paresseux : évite un cycle de chargement, fail-soft si ROI indispo.
  let revenueByTrigger = {};
  try {
    const { attributedRevenueByTrigger } = require('./marketing-roi');
    revenueByTrigger = await attributedRevenueByTrigger(centerId, { days: 365 });
  } catch (error) {
    revenueByTrigger = {};
  }
  const rows = buildPatternRows(result.rows, revenueByTrigger);
  for (const pattern of rows) {
    await pool.query(
      `insert into marketing_patterns (center_id, context_key, kind, channel, trigger, avg_net_delta, avg_raw_delta, n, wins, confidence, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (center_id, context_key) do update set
         kind = excluded.kind, channel = excluded.channel, trigger = excluded.trigger,
         avg_net_delta = excluded.avg_net_delta, avg_raw_delta = excluded.avg_raw_delta,
         n = excluded.n, wins = excluded.wins, confidence = excluded.confidence, updated_at = now();`,
      [centerId, pattern.context_key, pattern.kind, pattern.channel, pattern.trigger, pattern.avgNetDelta, pattern.avgRawDelta, pattern.n, pattern.wins, pattern.confidence],
    );
  }
  // U8 : le revenu attribué est calculé et rattaché aux patterns (buildPatternRows)
  // et remonté ici ; la persistance d'une colonne revenue nécessiterait une
  // migration marketing_patterns (hors périmètre de cette passe).
  const attributedRevenue = rows.reduce((sum, pattern) => sum + (pattern.revenue || 0), 0);
  return { ok: true, centerId, patterns: rows.length, attributedRevenue };
}

async function listMarketingPatterns(centerId = 'libramont', { limit = 20 } = {}) {
  const result = await getPool().query(
    `select context_key, kind, channel, trigger, avg_net_delta, avg_raw_delta, n, wins, confidence
     from marketing_patterns where center_id = $1
     order by avg_net_delta desc nulls last, n desc limit $2;`,
    [centerId, Number(limit) || 20],
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({
    contextKey: row.context_key,
    kind: row.kind,
    channel: row.channel,
    trigger: row.trigger,
    netDeltaPct: row.avg_net_delta === null ? null : Number(row.avg_net_delta),
    rawDeltaPct: row.avg_raw_delta === null ? null : Number(row.avg_raw_delta),
    n: Number(row.n),
    wins: Number(row.wins),
    confidence: row.confidence,
  }));
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
             signature, status, proposed_at, applied_at, measured_at, result,
             payload, due_date::text as due_date
      from marketing_insights
      where ${where}
      order by proposed_at desc
      limit $${params.length};
    `,
    params,
  );
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

async function setInsightStatus(id, status, { centerId = '' } = {}) {
  if (!['applied', 'ignored'].includes(status)) {
    const error = new Error('Statut invalide (applied ou ignored).');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  // Scope centre (audit RUN C, isolation multi-tenant) : un id d'un autre
  // centre rend 404, jamais une mutation trans-centre.
  const result = await getPool().query(
    `
      update marketing_insights
      set status = $2, applied_at = case when $2 = 'applied' then now() else applied_at end
      where id = $1 and ($3 = '' or center_id = $3)
      returning id, status, applied_at;
    `,
    [Number(id), status, String(centerId || '')],
  );
  if (!result.rows[0]) {
    const error = new Error('Insight introuvable.');
    error.statusCode = 404;
    error.expose = true;
    throw error;
  }
  return { id: Number(result.rows[0].id), status: result.rows[0].status, appliedAt: result.rows[0].applied_at };
}

// « Ta période » : plage de dates LIBRE (demande Movsar, pas figée à 7 jours)
// vue par le copilote marketing : météo prévue + calendrier (congés FWB,
// fériés, événements locaux) + idées de l'agent rattachées à leur jour
// (targetDate du data_basis si présent, sinon posées sur le 1er jour).
// Défaut : aujourd'hui → +6 j. Cap 31 jours (au-delà la bande devient illisible
// et la prévision météo n'existe plus : J+14 max chez Open-Meteo).
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
// proposition (signature suffixée : la dédupe 7 j s'applique au clone aussi).
async function redoInsight(id, { centerId = '' } = {}) {
  const source = await getPool().query(
    'select * from marketing_insights where id = $1 and ($2 = \'\' or center_id = $2) limit 1;',
    [Number(id), String(centerId || '')],
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
  // due_date = aujourd'hui : une relance est actionnable MAINTENANT. Sans
  // due_date, le clone triait dernier (voire hors du slice) pendant que le
  // toast promettait « premiere position » (audit RUN C, mensonge du toast).
  const inserted = await getPool().query(
    `insert into marketing_insights (center_id, kind, title, body, channel, ready_content, data_basis, signature, due_date)
     values ($1, $2, $3, $4, $5, $6, $7, $8, current_date)
     returning id, center_id, kind, title, body, channel, ready_content, data_basis, signature, status, proposed_at;`,
    [
      row.center_id,
      row.kind || 'idea',
      `${row.title} (relance)`,
      `${row.body ? `${row.body} ` : ''}Cette idée a été mesurée « ça a marché », on la relance.`,
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
  SCHOOL_HOLIDAYS_FWB,
  // Constantes / seuils
  HEAT_THRESHOLD_C,
  STRONG_HEAT_THRESHOLD_C,
  SEUIL_IDEE_CHALEUR_C,
  SEUIL_ACTIVITE_JOUR,
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
  expireStaleInsights,
  makeIdeaSignature,
  renderIdeaContent,
  polishIdeaWithAi,
  nomsPropresNonAncres,
  buildDataFactsBundle,
  runDataIdeasCycle,
  computeInsightMeasurement,
  measureAppliedInsights,
  // Boucle d'apprentissage (effet net + mémoire par contexte + réinjection)
  computeNetInsightMeasurement,
  buildPatternRows,
  rankCandidatesByPatterns,
  patternContextKey,
  patternConfidence,
  aggregateMarketingPatterns,
  listMarketingPatterns,
  // Lecture / statut
  listDailyMetrics,
  listMarketingInsights,
  setInsightStatus,
  buildMarketingWeek,
  redoInsight,
};
