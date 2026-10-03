// LA REPARTITION PAR ACTIVITE NE MENT PLUS NULLE PART.
//
// Ne du 2026-08-18 : le donut du dashboard affichait « Complet 43 % » pour un
// dossier (pourcentage = RESTE de 100), et la Direction rangeait toute visite
// (golf, arcades, billards) sous « Bowling » dans son bilan. La grammaire est
// desormais UNIQUE (lib/reservation-activities) et servie par
// buildDirectionAnalytics sous byActivity. Ce gate fixe les deux contrats.
//
// Lancement : node scripts/reservation-activities-check.js
const { reservationActivityEntries, reservationActivityBucket } = require('../lib/reservation-activities');
const { buildDirectionAnalytics } = require('../lib/direction-analytics');

let failures = 0;
function ok(cond, label) { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`); if (!cond) failures += 1; return cond; }

// --- Le classifieur, cas par cas -----------------------------------------
const golf = { type: 'visite', program: { items: [{ activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', planned: false }] } };
ok(reservationActivityBucket(golf).label === 'Minigolf Blacklight', 'une visite golf seule EST du golf, jamais du bowling');
const multi = { type: 'visite', program: { items: [{ activityId: 'bowling', name: 'Bowling', planned: true }, { activityId: 'billards', name: 'Billards', planned: false }] } };
ok(reservationActivityBucket(multi).key === 'multi', 'bowling + billards = Multi-activités');
ok(reservationActivityEntries(multi).length === 2, 'le panier multi garde ses 2 activites en occurrences');
ok(reservationActivityBucket({ type: 'formule', formuleId: 'f1' }).label === 'Formules', 'une formule reste une formule');
ok(reservationActivityBucket({ type: 'laser' }).label === 'Laser Game', 'le type laser se nomme Laser Game');
ok(reservationActivityBucket({ type: 'bowling' }).key === 'bowling', 'le type bowling reste bowling');
ok(reservationActivityBucket({ type: 'hax' }).label === 'Autre activité', 'un type inconnu garde un nom honnete');

// --- byActivity dans les analytics Direction ------------------------------
const END = '2026-08-18';
const history = [
  { name: 'A', phone: '1', status: 'paid', price: 40, pax: 4, date: END, type: 'bowling', lanes: [1], duration: 1, startTime: '14:00' },
  { name: 'B', phone: '2', status: 'paid', price: 50, pax: 5, date: END, type: 'visite', startTime: '15:00', program: { items: [{ activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight' }] } },
  { name: 'C', phone: '3', status: 'pending', price: 96, pax: 6, date: END, type: 'visite', startTime: '16:00', program: { items: [{ activityId: 'bowling', name: 'Bowling' }, { activityId: 'billards', name: 'Billards' }] } },
  { name: 'D', phone: '4', status: 'paid', price: 120, pax: 8, date: END, type: 'formule', formuleId: 'f1', startTime: '17:00' },
  { name: 'E', phone: '5', status: 'cancelled', price: 999, pax: 9, date: END, type: 'bowling', startTime: '18:00' },
];
const analytics = buildDirectionAnalytics({ history, startDate: END, endDate: END, center: { id: 'libramont' } });
const byActivity = analytics.byActivity || {};
ok(Object.keys(byActivity).length === 4, `4 buckets reels (${Object.keys(byActivity).join(', ')})`);
ok(byActivity.minigolf_blacklight && byActivity.minigolf_blacklight.revenue === 50, 'le golf porte SON chiffre (50)');
ok(byActivity.multi && byActivity.multi.count === 1 && byActivity.multi.label === 'Multi-activités', 'le panier multi a son bucket');
ok(byActivity.formule && byActivity.formule.revenue === 120, 'les formules portent leur chiffre');
const sum = Object.values(byActivity).reduce((s, v) => s + v.revenue, 0);
ok(sum === analytics.totals.revenue, `la repartition SOMME au chiffre total (${sum} = ${analytics.totals.revenue}) : aucun pourcentage n est un reste`);
ok(analytics.byType && analytics.byType.visite, 'byType reste servi (compatibilite)');
const clientB = (analytics.clients.top || []).find((c) => c.name === 'B');
ok(clientB && clientB.favoriteLabel === 'Minigolf Blacklight', `le favori d un client golf se nomme Minigolf (${clientB && clientB.favoriteLabel})`);

// --- Contre-epreuve : l ancien monde a 3 cases est bien mort --------------
ok(!Object.keys(byActivity).some((k) => k === 'complet' || (byActivity[k].label || '').includes('Complet')),
  'contre-epreuve : aucun bucket « Complet » ne peut renaitre de ce calcul');

// Participants par activité : les KPI visiteurs et les paniers multi restent
// au niveau du dossier, les activités seules/exportées portent leur effectif.
const subsetHistory = [
  { name: 'Golf', status: 'paid', price: 30, pax: 20, date: END, type: 'visite', program: { items: [{ activityId: 'minigolf_blacklight', name: 'Minigolf Blacklight', participants: 3 }] } },
  { name: 'Arcades', status: 'paid', price: 0, pax: 20, date: END, type: 'visite', program: { items: [{ activityId: 'arcades', name: 'Arcades', participants: 4 }] } },
  { name: 'Multi', status: 'paid', price: 109, pax: 20, date: END, type: 'visite', program: { items: [{ activityId: 'bowling', participants: 6 }, { activityId: 'laser_game', participants: 7 }] } },
  { name: 'Formule', status: 'paid', price: 200, pax: 20, date: END, type: 'formule', formuleId: 'f1', program: { items: [{ activityId: 'bowling', participants: 6 }] } },
];
const subsetAnalytics = buildDirectionAnalytics({ history: subsetHistory, startDate: END, endDate: END, center: { id: 'libramont' } });
ok(subsetAnalytics.byActivity.minigolf_blacklight.pax === 3, 'golf seul : 3 participants parmi 20 visiteurs');
ok(subsetAnalytics.byActivity.arcades.pax === 4, 'arcades seules : 4 participants parmi 20 visiteurs');
ok(subsetAnalytics.byActivity.multi.pax === 20 && subsetAnalytics.byActivity.multi.revenue === 109, 'panier multi : visiteurs et chiffre une seule fois');
ok(subsetAnalytics.byActivity.formule.pax === 20, 'formule : le contrat global de participants est conservé');
ok(subsetAnalytics.totals.pax === 80 && subsetAnalytics.daily[0].pax === 80 && subsetAnalytics.byType.visite.pax === 60, 'KPI globaux, quotidien et types conservent les visiteurs');
ok(byActivity.minigolf_blacklight.pax === 5, 'historique sans participants : repli sur les visiteurs');
ok(Object.values(subsetAnalytics.byActivity).reduce((sum, row) => sum + row.revenue, 0) === subsetAnalytics.totals.revenue, 'chiffre par activité sans double comptage');

// Exécute le vrai export CSV sans DOM ni téléchargement externe.
(async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const context = vm.createContext({ document: { getElementById: () => null }, analyticsFixture: subsetAnalytics });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'admin-data.js'), 'utf8'), context);
  vm.runInContext('dhState.analytics = analyticsFixture; dhDownload = (name, content) => { globalThis.exportedCsv = content; };', context);
  await vm.runInContext("dhExportCsv('formules')", context);
  ok(context.exportedCsv.includes('"Activité";"Minigolf Blacklight";"1";"3";"30"'), 'CSV activités : golf 3 participants et 30 EUR');
  ok(context.exportedCsv.includes('"Activité";"Arcades";"1";"4";"0"'), 'CSV activités : arcades 4 participants au tarif accueil');
  if (failures) { console.error(`\nreservation-activities-check: ${failures} echec(s).`); process.exitCode = 1; return; }
  console.log('\nreservation-activities-check: ALL OK - une seule grammaire d activites, du dashboard au bilan Direction.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
