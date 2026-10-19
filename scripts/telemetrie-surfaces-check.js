// LA TELEMETRIE INTERNE NE SORT PAS DES ECRANS PROPRIETAIRE.
//
// Mesure du 2026-08-31, la nuit avant l'ouverture Fun Galaxy Libramont.
//
// Regle du proprietaire : aucune note d'algo (X/100), aucune enum interne en
// anglais brut n'atteint le tunnel public, les ecrans du gerant/staff, ni un
// email. Ces valeurs vivent dans la donnee et dans l'espace proprietaire.
// Un premier balayage (commit a3554f5) avait nettoye les ecrans ; deux fuites
// avaient survecu, toutes deux mesurees par execution :
//
//   1. L'email staff_review_request (le premier mail operationnel que le staff
//      lit) affichait « eleve (78/100) » : la note brute de l'algo de risque,
//      juste apres que riskLabelFr a traduit le niveau. lib/ops-communications.js.
//   2. L'export Excel Direction (rapport comptable telecharge par le gerant,
//      permission reports.export) poussait riskLevel (low/high/critical) et
//      validationStatus (staff_review...) en anglais brut dans un document
//      officiel en francais. assets/admin-console.js buildAdminExcelXml.
//
// Trois proprietes :
//   A. MONTAGE : le mail se construit (sujet, details) et l'export rend bien
//      les reservations fournies. Prouve que le gate mesure.
//   B. L'EMAIL : la ligne Situation dit la raison en francais, sans note /100.
//   C. L'EXPORT : aucune cellule ne porte une enum brute (low, medium, high,
//      critical, staff_review) ; les colonnes Risque et Validation parlent le
//      francais de la pastille du tableau du jour.
//
// Contre-epreuve par mutation : on remet la note /100 dans le mail, le gate
// doit rougir sur B ; on remet l'enum brute dans l'export, il doit rougir
// sur C. Restauration a l'identique verifiee par le lanceur.
//
// Lancement : node scripts/telemetrie-surfaces-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OC = path.join(ROOT, 'lib', 'ops-communications.js');
const ADMIN = path.join(ROOT, 'assets', 'admin-console.js');

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

const RESERVATIONS = [
  { id: 101, date: '2026-09-05', startTime: '15:00', name: 'Marie Dupont', phone: '0470112233', email: 'marie@example.com', label: 'FORMULE 4', type: 'formule', formuleId: 'f4', pax: 12, status: 'pending', price: 468, riskLevel: 'high', riskScore: 78, validationStatus: 'staff_review', centerId: 'libramont' },
  { id: 102, date: '2026-09-06', startTime: '11:00', name: 'Paul Martin', phone: '0470000001', email: '', label: 'BOWLING', type: 'bowling', pax: 4, status: 'pending', price: 60, riskLevel: 'low', validationStatus: 'confirmed', centerId: 'libramont' },
  { id: 103, date: '2026-09-07', startTime: '18:00', name: 'Sarah Leroy', phone: '0470000002', email: '', label: 'LASER', type: 'laser', pax: 20, status: 'pending', price: 300, riskLevel: 'critical', validationStatus: 'confirmed', centerId: 'libramont' },
];

// --- B. L'email staff_review_request ----------------------------------------
function checkEmail() {
  const oc = require(OC);
  const message = oc.buildMessage({ reservation: RESERVATIONS[0], templateId: 'staff_review_request', channel: 'email' });
  // Depuis le 2026-10-05 le mail est ecrit en phrases (plus de ligne Risque
  // ni Situation) : on verifie qu il se construit et qu AUCUN texte ne porte
  // le niveau brut du moteur.
  const tout = [message && message.subject, message && message.body, ...((message && message.details) || []).map((d) => `${d.label} ${d.value}`)].join(' | ');
  ok(Boolean(message && message.subject && (message.details || []).length),
    `montage : le mail staff_review_request se construit (sujet « ${message && message.subject} »)`);
  ok(!/\b(high|critical|medium|low|staff_review)\b/.test(tout),
    `email : aucun niveau brut du moteur dans le mail (« ${tout.slice(0, 120)} »)`);
  const serialise = JSON.stringify(message);
  ok(!serialise.includes('/100'),
    'email : aucune note /100 nulle part dans le message');
}

// --- C. L'export Excel Direction ---------------------------------------------
function chargeAdminConsole() {
  const src = fs.readFileSync(ADMIN, 'utf8');
  const bac = {
    console: { log() {}, warn() {}, error() {} },
    Date, JSON, Math, Number, String, Array, Object, Boolean, RegExp, Intl, isNaN, parseInt, parseFloat,
    document: { createElement: () => ({ style: {}, setAttribute() {}, remove() {}, appendChild() {} }), body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    navigator: {}, location: { href: '' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    state: { adminDate: '2026-09-01', adminCenterId: 'libramont', adminPeriod: 'month' },
    fetch: () => Promise.reject(new Error('pas de reseau dans le gate')),
  };
  bac.window = bac;
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'admin-console.js', timeout: 20000 });
  // Les helpers partages vivent dans app-main.js : on ne les fournit QUE s'ils
  // manquent, jamais par-dessus une vraie fonction d'admin-console.js.
  vm.runInContext(`
    if (typeof parseLocalDate === 'undefined') parseLocalDate = (s) => new Date(String(s) + 'T00:00:00');
    if (typeof getReservationLabel === 'undefined') getReservationLabel = (r) => r.label || r.type || '';
    if (typeof getReservationGuestOps === 'undefined') getReservationGuestOps = () => ({ waiverRequired: false, waiverDone: false, checkInDone: false });
    if (typeof formatClockDisplay === 'undefined') formatClockDisplay = (v) => String(v || '');
    if (typeof getLaserWindowsFromReservation === 'undefined') getLaserWindowsFromReservation = () => [];
    if (typeof getBowlingWindowsFromReservation === 'undefined') getBowlingWindowsFromReservation = () => [];
    if (typeof getLaserGameCountForReservation === 'undefined') getLaserGameCountForReservation = () => 0;
    if (typeof escapeHtml === 'undefined') escapeHtml = (s) => String(s || '');
    if (typeof todayStr === 'undefined') todayStr = () => '2026-09-01';
    if (typeof getVisibleOpsCommunications === 'undefined') getVisibleOpsCommunications = (list) => list || [];
    if (typeof formatDateTimeFr === 'undefined') formatDateTimeFr = (v) => String(v || '');
    if (typeof getAgentLabel === 'undefined') getAgentLabel = (v) => String(v || '');
    if (typeof getReservationClientKey === 'undefined') getReservationClientKey = (r) => String(r.name || r.id);
    if (typeof formatEuro === 'undefined') formatEuro = (v) => String(v);
    if (typeof getAdminResourceText === 'undefined') getAdminResourceText = () => '';
    if (typeof formatMoney === 'undefined') formatMoney = (v) => String(v);
    if (typeof formatDurationLabel === 'undefined') formatDurationLabel = (v) => String(v);
  `, bac);
  return bac;
}

function checkExport() {
  const bac = chargeAdminConsole();
  const center = { id: 'libramont', name: 'Fun Galaxy Libramont' };
  let metrics;
  try {
    metrics = bac.buildAdminMetrics(RESERVATIONS, center);
  } catch (error) {
    metrics = { reservations: 3, players: 36, revenue: 828, collected: 0, avgTicket: 276, bowlingOccupancy: 0, laserOccupancy: 0, laneHours: 0, bowlingCapacity: 0, laserLaunches: 0, laserPlayers: 0, sentMails: 0, queuedMails: 0, failedMails: 0, suggestions: 0, events: 0, pendingCount: 3, arrivedCount: 0, paidCount: 0, formulaCount: 1 };
  }
  const payload = {
    exportedAt: '2026-09-01T10:00:00.000Z', center,
    period: { startDate: '2026-09-01', endDate: '2026-09-30', period: 'month' },
    metrics, reservations: RESERVATIONS,
    laneStatuses: {}, communications: [], suggestions: [], events: [],
    agentStack: null, simulation: null, knowledge: null,
  };
  const xml = bac.buildAdminExcelXml(payload);
  const feuille = String(xml).split('ss:Name="Reservations"')[1];
  ok(Boolean(feuille) && feuille.includes('Marie Dupont') && feuille.includes('Sarah Leroy'),
    'montage : l export rend la feuille Reservations avec les dossiers fournis');
  const cellules = (String(xml).match(/<Data[^>]*>([^<]*)<\/Data>/g) || []).map((cell) => cell.replace(/<[^>]+>/g, ''));
  const brutes = cellules.filter((valeur) => /^(low|medium|high|critical|staff_review)$/.test(valeur.trim()));
  ok(brutes.length === 0,
    `export : aucune cellule ne porte une enum interne brute (${brutes.slice(0, 4).join(', ') || 'zero'})`);
  const attendus = ['Élevé', 'Normal', 'Critique', 'À vérifier', 'Validée'];
  const manquants = attendus.filter((mot) => !cellules.includes(mot));
  ok(manquants.length === 0,
    `export : les colonnes Risque et Validation parlent francais (manquent : ${manquants.join(', ') || 'rien'})`);
}

function main() {
  checkEmail();
  checkExport();
  if (failures) {
    console.error(`\ntelemetrie-surfaces-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\ntelemetrie-surfaces-check: ALL OK (la telemetrie interne reste dans la donnee)');
}

if (process.argv.includes('--mutate')) {
  const { spawnSync } = require('child_process');
  let rate = 0;

  // Mutation 1 : la note /100 revient dans le mail.
  const sourceOc = fs.readFileSync(OC, 'utf8');
  // La ligne Risque a laisse la place a la Situation (2026-10-05) : la note
  // /100 se remet sur la ligne vivante.
  const marqueurOc = "{ label: 'Personnes', value: `${reservation.pax}` },";
  if (!sourceOc.includes(marqueurOc)) {
    console.error('mutation 1 impossible : la ligne Personnes vivante est introuvable dans lib/ops-communications.js');
    process.exit(1);
  }
  fs.writeFileSync(OC, sourceOc.replace(marqueurOc,
    "{ label: 'Personnes', value: `${reservation.pax}${reservation.riskScore !== null && reservation.riskScore !== undefined ? ` (${reservation.riskScore}/100)` : ''}` },"));
  const run1 = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(OC, sourceOc);
  if (run1.status === 0) { console.error('CONTRE-EPREUVE 1 RATEE : le gate reste vert avec la note /100 remise.'); rate += 1; }
  else console.log('contre-epreuve 1 OK : remettre la note /100 dans le mail fait rougir le gate.');

  // Mutation 2 : l enum brute revient dans l export.
  const sourceAdmin = fs.readFileSync(ADMIN, 'utf8');
  // Les fins de ligne du fichier (CRLF dans une copie Windows) : l ancre en
  // LF seul ne s y trouvait jamais (2026-10-19).
  const eolAdmin = sourceAdmin.includes('\r\n') ? '\r\n' : '\n';
  const marqueurAdmin = `      getAdminRiskLabel(reservation),${eolAdmin}      getAdminValidationLabel(reservation.validationStatus),`;
  if (!sourceAdmin.includes(marqueurAdmin)) {
    console.error('mutation 2 impossible : les cellules traduites sont introuvables dans assets/admin-console.js');
    process.exit(1);
  }
  fs.writeFileSync(ADMIN, sourceAdmin.replace(marqueurAdmin,
    `      reservation.riskLevel || 'normal',${eolAdmin}      reservation.validationStatus || '',`));
  const run2 = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(ADMIN, sourceAdmin);
  if (run2.status === 0) { console.error('CONTRE-EPREUVE 2 RATEE : le gate reste vert avec l enum brute remise.'); rate += 1; }
  else console.log('contre-epreuve 2 OK : remettre l enum brute dans l export fait rougir le gate.');

  process.exit(rate ? 1 : 0);
}

main();
