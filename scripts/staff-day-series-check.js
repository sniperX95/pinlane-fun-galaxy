// LA SERIE QUOTIDIENNE DU DASHBOARD NE MENT PAS.
//
// Ne du bug du 2026-08-18 (capture Movsar) : la carte Revenus lisait le cache
// LOCAL du poste et affichait 0 sur tout jour jamais visite (« des fois ca
// montre des fois non »). La serie vient desormais du serveur via
// lib/staff-day-series : ce gate fixe son contrat sur des cas reels.
//
// Lancement : node scripts/staff-day-series-check.js
const { buildStaffDaySeries, isoAddDays } = require('../lib/staff-day-series');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

const START = '2026-08-12';
const END = '2026-08-18';
const rows = [
  { date: '2026-08-12', status: 'paid', price: 100, pax: 4, duration: 1, lanes: [1] },
  { date: '2026-08-12', status: 'confirmed', price: 50, pax: 2, duration: 1.5, lanes: [2, 3] },
  { date: '2026-08-12', status: 'cancelled', price: 999, pax: 9, duration: 2, lanes: [4] },
  { date: '2026-08-15', status: 'confirmed', price: 80, pax: 6, duration: 0, lanes: [] },
  { date: '2026-08-18', status: 'paid', price: 39, pax: 4, duration: 1, lanes: [5] },
  { date: '2026-08-20', status: 'paid', price: 500, pax: 10, duration: 1, lanes: [6] },
];
const series = buildStaffDaySeries(rows, START, END);

ok(series.length === 7, `un point PAR jour de la plage (${series.length}/7)`);
ok(series.every((day, index) => day.date === isoAddDays(START, index)), 'les dates se suivent sans trou');

const d12 = series.find(day => day.date === '2026-08-12');
ok(d12.revenue === 150, `2026-08-12 : CA prevu 150 (${d12.revenue}) ; l annulee n y entre pas`);
ok(d12.collected === 100, `2026-08-12 : encaisse 100 (${d12.collected})`);
ok(d12.reservations === 2, `2026-08-12 : 2 dossiers (${d12.reservations})`);
ok(d12.players === 6, `2026-08-12 : 6 joueurs (${d12.players})`);
ok(d12.laneHours === 4, `2026-08-12 : 4 heures de piste (1x1 + 1.5x2 = ${d12.laneHours})`);

const d13 = series.find(day => day.date === '2026-08-13');
ok(d13.revenue === 0 && d13.reservations === 0, 'un jour sans vente vaut ZERO, il existe quand meme');

const d18 = series.find(day => day.date === '2026-08-18');
ok(d18.revenue === 39 && d18.collected === 39, `le dernier jour de la plage est compte (${d18.revenue})`);

ok(!series.some(day => day.date === '2026-08-20'), 'une reservation HORS plage ne cree pas de point');

// Contre-epreuve : une serie fabriquee depuis un cache partiel (jours
// manquants) ne ressemble PAS a la sortie de cette fonction.
const partial = buildStaffDaySeries(rows.filter(row => row.date === '2026-08-18'), START, END);
ok(partial.find(day => day.date === '2026-08-12').revenue === 0,
  'contre-epreuve : ampute des donnees du 12, la serie y affiche 0 (le bug du cache local se VOIT)');

if (failures) { console.error(`\nstaff-day-series-check: ${failures} echec(s).`); process.exit(1); }
console.log('\nstaff-day-series-check: ALL OK - la serie quotidienne dit la plage entiere, zeros compris.');
