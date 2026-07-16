// Backfill du warehouse quotidien : métriques (depuis les réservations
// existantes) + météo archive Open-Meteo, pour toutes les dates ayant des
// résas (min(date) -> hier). Idempotent (upsert) : relançable sans risque.
//
// Usage : node scripts/backfill-daily-metrics.js [--center=libramont] [--dry-run]
// Env : DATABASE_URL (chargé depuis .env si absent). AUCUN log de l'URL DB.

const fs = require('fs');
const path = require('path');

// Chargement .env minimal (les scripts node locaux du repo n'ont pas dotenv).
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { getPool } = require('../lib/database');
const {
  buildDailyMetricsForDate,
  fetchOpenMeteoArchive,
  upsertDailyMetrics,
} = require('../lib/center-metrics');

const CENTER_COORDS = {
  libramont: { latitude: 49.92, longitude: 5.31 },
  gembloux: { latitude: 50.56, longitude: 4.69 },
};

function argValue(name, fallback = '') {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

function chunkRanges(dates, size = 90) {
  // Regroupe des dates ISO triées en plages contiguës bornées (appels archive).
  const ranges = [];
  let start = null;
  let prev = null;
  const flush = () => { if (start) ranges.push({ start, end: prev }); };
  for (const date of dates) {
    if (!start) { start = date; prev = date; continue; }
    const next = new Date(`${prev}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const contiguous = next.toISOString().slice(0, 10) === date;
    const spanDays = (new Date(`${date}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000;
    if (!contiguous || spanDays >= size) { flush(); start = date; }
    prev = date;
  }
  flush();
  return ranges;
}

async function main() {
  const centerId = argValue('center', 'libramont');
  const dryRun = process.argv.includes('--dry-run');
  const pool = getPool();

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const endDate = yesterday.toISOString().slice(0, 10);

  const datesResult = await pool.query(
    'select distinct date::text as date from reservations where center_id = $1 and date <= $2 order by date asc;',
    [centerId, endDate],
  );
  const dates = datesResult.rows.map((row) => row.date);
  if (!dates.length) {
    console.log(JSON.stringify({ ok: true, centerId, message: 'Aucune date à backfiller.' }));
    await pool.end();
    return;
  }
  console.log(`Backfill ${centerId} : ${dates.length} jours (${dates[0]} -> ${dates[dates.length - 1]})${dryRun ? ' [DRY-RUN]' : ''}`);

  // 1. Météo archive par plages contiguës (délai archive ~5 j : les tout
  //    derniers jours peuvent revenir null : la collecte cron les complètera).
  const weatherByDate = new Map();
  const coords = CENTER_COORDS[centerId] || CENTER_COORDS.libramont;
  for (const range of chunkRanges(dates)) {
    const rows = await fetchOpenMeteoArchive({ ...coords, startDate: range.start, endDate: range.end });
    if (rows) {
      for (const row of rows) weatherByDate.set(row.date, row);
    } else {
      console.log(`  météo indisponible pour ${range.start} -> ${range.end} (non bloquant)`);
    }
  }
  console.log(`Météo archive : ${weatherByDate.size} jours couverts.`);

  // 2. Métriques + upsert par date.
  let written = 0;
  for (const date of dates) {
    const metrics = await buildDailyMetricsForDate(centerId, date);
    const weather = weatherByDate.get(date) || null;
    if (!dryRun) await upsertDailyMetrics(centerId, date, metrics, weather);
    written += 1;
    if (written % 50 === 0) console.log(`  ${written}/${dates.length}...`);
  }
  console.log(JSON.stringify({ ok: true, centerId, days: written, weatherDays: weatherByDate.size, dryRun }));
  await pool.end();
}

main().catch((error) => {
  console.error('backfill FAIL:', error.message || error);
  process.exit(1);
});
