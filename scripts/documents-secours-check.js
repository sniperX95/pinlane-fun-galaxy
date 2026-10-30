'use strict';
// LE GATE DES DOCUMENTS DE SECOURS (2026-10-05).
//
// La feuille de secours (lib/feuille-secours.js) et le classeur du jour
// (lib/export-excel.js) sont ce que l'accueil tient en main si Pinlane tombe.
// Ce gate vérifie, sans base ni réseau :
//
//   [1] les règles des cases confirmées par le patron, table contre table :
//       1 piste 1 h -> « X », 2 pistes 1h30 -> « XX (1h30) », 3 pistes 30 min
//       -> « XXX (30 min) », 2 parties de laser -> « XX », une formule avec
//       minigolf + playground + arcades -> une croix dans chacune, une
//       activité sans colonne -> seulement dans l'annexe ;
//   [2] les contre-preuves : une règle mutée fait échouer la table, un texte
//       muté fait échouer les contrôles du PDF, un zip corrompu fait échouer
//       le lecteur. Un gate qui ne sait pas échouer ne garde rien ;
//   [3] le débordement : 7 dossiers dans la même demi-heure, tous imprimés ;
//       60 dossiers, tous imprimés, sur des pages « suite » ;
//   [4] le jour de fixture : 3 pages de grille + l'annexe, accents et « € »
//       dans le texte extrait (pdftotext), une note interne « [equipe] »
//       jamais imprimée, rendu sans erreur (pdftoppm) ;
//   [5] l'écrivain PDF : encodage WinAnsi, mesures AFM, troncature, coupe,
//       table xref exacte ;
//   [6] le classeur : zip valide, XML bien formés, noms des feuilles, lignes
//       d'en-tête, nombres stockés en nombres, lignes d'état vide, note
//       interne absente, conversion LibreOffice sans erreur (quand soffice
//       est installé ; sinon le gate le dit et ne prétend rien).
//
// Lancement : npm run test:documents-secours (dans test:ops:all).

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const pdfWriter = require(path.join(root, 'lib/pdf-writer.js'));
const feuille = require(path.join(root, 'lib/feuille-secours.js'));
const xlsxWriter = require(path.join(root, 'lib/xlsx-writer.js'));
const exportExcel = require(path.join(root, 'lib/export-excel.js'));

let echecs = 0;
let reussites = 0;
function ok(cond, label) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (cond) reussites += 1; else echecs += 1;
  return cond;
}
function section(titre) { console.log(`\n[${titre}]`); }
function outil(nom) {
  const r = spawnSync('which', [nom], { encoding: 'utf8' });
  const chemin = r.status === 0 ? r.stdout.trim() : '';
  // Sous Windows, le `which` de Git Bash rend un chemin MSYS (/mingw64/bin/x)
  // que node ne sait pas lancer (ENOENT) : il se traduit (2026-10-19).
  if (chemin && process.platform === 'win32' && chemin.startsWith('/')) {
    const w = spawnSync('cygpath', ['-w', chemin], { encoding: 'utf8' });
    return w.status === 0 ? w.stdout.trim() : '';
  }
  return chemin;
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'documents-secours-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* rien */ } });

// Le jour de fixture (26 dossiers, 2026-10-03, Libramont) et le catalogue.
const FIXTURE = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/documents-secours-jour.json'), 'utf8'));
const DATE = FIXTURE[0].date;
const FORMULES = Object.fromEntries(require(path.join(root, 'ops-knowledge/formulas.json')).formulas.map((f) => [f.id, f.name]));
const OPTIONS = { date: DATE, centreNom: 'Fun Galaxy Libramont', formules: FORMULES, imprimeLe: '05/10/2026 à 09:00' };

// Un dossier synthétique : { bowling: { lanes, minutes }, duckpin, laser: { games }, autres: ['minigolf_blacklight'] }.
let prochainId = 90000;
function dossier({ nom = 'Client test', heure = '14:00', pax = 6, bowling = null, duckpin = null, laser = null, autres = [], notes = '', validationStatus = 'confirmed', status = 'pending', formuleId = '', extra = {} } = {}) {
  const items = [];
  const timeline = [];
  if (bowling) {
    items.push({ activityId: 'bowling', name: 'Bowling', laneCount: bowling.lanes, minutes: bowling.minutes, duration: bowling.minutes / 60 });
    timeline.push({ type: 'activity', activityId: 'bowling', label: 'Bowling', startTime: heure, endTime: feuille.hhmmDe(feuille.minutesDe(heure) + bowling.minutes), durationMinutes: bowling.minutes, requiredLanes: bowling.lanes, players: pax, countIndex: 1 });
  }
  if (duckpin) {
    items.push({ activityId: 'duckpin_bowling', name: 'Duckpin Bowling', laneCount: duckpin.lanes, minutes: duckpin.minutes, duration: duckpin.minutes / 60 });
    timeline.push({ type: 'activity', activityId: 'duckpin_bowling', label: 'Duckpin Bowling', startTime: heure, endTime: feuille.hhmmDe(feuille.minutesDe(heure) + duckpin.minutes), durationMinutes: duckpin.minutes, requiredLanes: duckpin.lanes, players: pax, countIndex: 1 });
  }
  if (laser) {
    items.push({ activityId: 'laser_game', name: 'Laser Game', games: laser.games, minutes: 30 * laser.games });
    for (let g = 1; g <= laser.games; g += 1) timeline.push({ type: 'activity', activityId: 'laser_game', label: 'Laser Game', startTime: feuille.hhmmDe(feuille.minutesDe(heure) + 60 + 30 * (g - 1)), endTime: feuille.hhmmDe(feuille.minutesDe(heure) + 85 + 30 * (g - 1)), durationMinutes: 25, players: pax, countIndex: g });
  }
  for (const id of autres) timeline.push({ type: 'activity', activityId: id, label: id, startTime: heure, endTime: feuille.hhmmDe(feuille.minutesDe(heure) + 45), durationMinutes: 45 });
  prochainId += 1;
  return {
    id: prochainId, name: nom, phone: '+32 470 00 00 00', email: 'test@exemple.be', date: DATE, startTime: heure, duration: 1, lanes: [], pax, status, basePrice: 100, price: 100,
    type: formuleId ? 'formule' : 'bowling', formuleId, label: 'Test', paymentMethod: '', notes, program: formuleId ? null : { items, price: 100, priceComplete: true }, channel: 'staff', centerId: 'libramont',
    opsPlan: { startTime: heure, timeline, assignedLanes: [] }, validationStatus, ...extra,
  };
}

// ---------------------------------------------------------------------------
section('1. Les règles des cases, table contre table');
// ---------------------------------------------------------------------------
const TABLE = [
  { libelle: '1 piste, 1 h -> X', resa: dossier({ bowling: { lanes: 1, minutes: 60 } }), colonne: 'bowling', attendu: 'X' },
  { libelle: '2 pistes, 1h30 -> XX (1h30)', resa: dossier({ bowling: { lanes: 2, minutes: 90 } }), colonne: 'bowling', attendu: 'XX (1h30)' },
  { libelle: '3 pistes, 30 min -> XXX (30 min)', resa: dossier({ bowling: { lanes: 3, minutes: 30 } }), colonne: 'bowling', attendu: 'XXX (30 min)' },
  { libelle: '4 pistes, 2 h -> XXXX (2h)', resa: dossier({ bowling: { lanes: 4, minutes: 120 } }), colonne: 'bowling', attendu: 'XXXX (2h)' },
  { libelle: 'duckpin 2 pistes 1 h -> XX (même règle que le bowling)', resa: dossier({ duckpin: { lanes: 2, minutes: 60 } }), colonne: 'duckpin', attendu: 'XX' },
  { libelle: 'duckpin 1 piste 1h30 -> X (1h30)', resa: dossier({ duckpin: { lanes: 1, minutes: 90 } }), colonne: 'duckpin', attendu: 'X (1h30)' },
  { libelle: '2 parties de laser -> XX', resa: dossier({ laser: { games: 2 } }), colonne: 'lg', attendu: 'XX' },
  { libelle: '1 partie de laser -> X', resa: dossier({ laser: { games: 1 } }), colonne: 'lg', attendu: 'X' },
  { libelle: '3 parties de laser -> XXX', resa: dossier({ laser: { games: 3 } }), colonne: 'lg', attendu: 'XXX' },
  { libelle: 'pas de bowling -> case vide', resa: dossier({ laser: { games: 1 } }), colonne: 'bowling', attendu: '' },
  { libelle: 'formule minigolf + playground + arcades -> Golf X', resa: dossier({ formuleId: 'f7', autres: ['minigolf_blacklight', 'playground', 'arcade_credit'] }), colonne: 'golf', attendu: 'X' },
  { libelle: 'formule minigolf + playground + arcades -> Playgr X', resa: dossier({ formuleId: 'f7', autres: ['minigolf_blacklight', 'playground', 'arcade_credit'] }), colonne: 'playgr', attendu: 'X' },
  { libelle: 'formule minigolf + playground + arcades -> Arcades X', resa: dossier({ formuleId: 'f7', autres: ['minigolf_blacklight', 'playground', 'arcade_credit'] }), colonne: 'arcades', attendu: 'X' },
  { libelle: 'fun_run -> Pixel X', resa: dossier({ autres: ['fun_run'] }), colonne: 'pixel', attendu: 'X' },
  { libelle: 'golf_oclock -> O\u2019Clock X', resa: dossier({ autres: ['golf_oclock'] }), colonne: 'oclock', attendu: 'X' },
  { libelle: 'billards -> Billard X', resa: dossier({ autres: ['billards'] }), colonne: 'billard', attendu: 'X' },
  { libelle: 'arcade_time -> Arcades X (une seule croix, pas de minutes)', resa: dossier({ autres: ['arcade_time'] }), colonne: 'arcades', attendu: 'X' },
];
function verifierTable(texteCase) {
  return TABLE.filter((cas) => texteCase(cas.resa, cas.colonne) !== cas.attendu).map((cas) => `${cas.libelle} (obtenu « ${texteCase(cas.resa, cas.colonne)} »)`);
}
const echecsTable = verifierTable((r, c) => feuille.texteCase(r, c));
ok(echecsTable.length === 0, `la table des ${TABLE.length} cas passe${echecsTable.length ? ` : ${echecsTable.join(' ; ')}` : ''}`);
for (const cas of TABLE) ok(feuille.texteCase(cas.resa, cas.colonne) === cas.attendu, `${cas.libelle}`);

// Les règles sur le jour de fixture (vrais dossiers du moteur).
const parNom = (nom) => FIXTURE.find((r) => r.name === nom);
ok(feuille.texteCase(parNom('Famille Janssens'), 'bowling') === 'X (1h30)', 'fixture : Janssens, bowling 1 piste 1h30 -> « X (1h30) »');
ok(feuille.texteCase(parNom('Scouts de Neufchâteau'), 'bowling') === 'XXXXXXX', 'fixture : Scouts, 7 pistes -> « XXXXXXX »');
ok(feuille.texteCase(parNom('Scouts de Neufchâteau'), 'lg') === 'X', 'fixture : Scouts, 1 partie en 2 vagues -> « X » (pas « XX »)');
ok(feuille.texteCase(parNom('Dupont'), 'lg') === 'XX', 'fixture : Dupont, 2 parties -> « XX »');
ok(feuille.texteCase(parNom('Anniversaire de Noah'), 'lg') === 'XX', 'fixture : formule 4 sans items, 2 parties planifiées -> « XX »');
ok(feuille.texteCase(parNom('Anniversaire de Noah'), 'bowling') === 'XX', 'fixture : formule 4, 2 pistes 1 h -> « XX »');
ok(feuille.texteCase(parNom('Hôtel des Ardennes'), 'golf') === 'X' && feuille.texteCase(parNom('Hôtel des Ardennes'), 'arcades') === 'X', 'fixture : activités libres non planifiées -> Golf X, Arcades X');
const lea = feuille.casesActivites(parNom('Anniversaire de Léa'));
ok(lea.playgr === 'X' && lea.golf === 'X' && lea.arcades === 'X' && lea.bowling === '' && lea.lg === '', 'fixture : formule 7 -> Playgr, Golf, Arcades cochés, rien d\u2019autre');
ok(feuille.activitesSansColonne(parNom('Anniversaire de Léa')).sort().join(',') === 'party_table,service_drinks', 'fixture : table anniversaire et boissons n\u2019ont pas de colonne (annexe seulement)');
const hache = dossier({ nom: 'Hache', autres: ['axe_throwing', 'free_roaming_vr'] });
ok(Object.values(feuille.casesActivites(hache)).every((v) => v === ''), 'lancer de hache + VR : aucune colonne cochée');
ok(feuille.activitesSansColonne(hache).join(',') === 'axe_throwing,free_roaming_vr', 'lancer de hache + VR : listés pour l\u2019annexe');
ok(feuille.texteProgramme(hache).join(' | ').includes('axe_throwing') && feuille.texteProgramme(hache).join(' | ').includes('free_roaming_vr'), 'lancer de hache + VR : dans le programme détaillé');
ok(feuille.texteCase(dossier({ duckpin: { lanes: 2, minutes: 90 } }), 'duckpin', { duckpin: 'simple' }) === 'X', 'réglage REGLES.duckpin = simple -> une seule croix');
ok(feuille.REGLES.duckpin === 'pistes', 'le réglage par défaut du duckpin est « pistes » (comme le bowling)');

section('1b. Nom, formule, statut, notes');
ok(feuille.libelleFormule({ formuleId: 'f4' }, FORMULES) === 'F4', 'FORMULE 4 -> « F4 »');
ok(feuille.libelleFormule({ formuleId: 'mm' }, FORMULES) === 'Matin Malin', 'MATIN MALIN -> « Matin Malin »');
ok(feuille.libelleFormule({ formuleId: 'kfd' }, FORMULES) === 'Kids Fun Day', 'KIDS FUN DAY -> « Kids Fun Day »');
ok(feuille.libelleFormule({ type: 'custom' }, FORMULES) === 'Sur mesure' && feuille.libelleFormule({ customRequest: { message: 'x' } }, FORMULES) === 'Sur mesure', 'dossier sur mesure -> « Sur mesure »');
ok(feuille.libelleFormule({ formuleId: '' }, FORMULES) === '', 'à la carte -> case vide');
ok(feuille.libelleFormuleLong({ formuleId: 'f4' }, FORMULES) === 'Formule 4', 'annexe : « Formule 4 »');
ok(feuille.aConfirmer({ validationStatus: 'staff_review' }) && !feuille.aConfirmer({ validationStatus: 'confirmed' }), '« à confirmer » seulement pour staff_review');
ok(feuille.statutFr({ status: 'paid' }) === 'Payée' && feuille.statutFr({ status: 'arrived' }) === 'Arrivée' && feuille.statutFr({ status: 'pending', validationStatus: 'staff_review' }) === 'À confirmer' && feuille.statutFr({ status: 'cancelled' }) === 'Annulée', 'statuts en français');
ok(feuille.canalFr('public') === 'En ligne' && feuille.canalFr('staff') === 'Comptoir', 'canal : en ligne / comptoir');
ok(feuille.prixTexte({ price: 280, basePrice: 495 }) === '280 € (au lieu de 495 €)' && feuille.prixTexte({ price: 39, basePrice: 39 }) === '39 €' && feuille.prixTexte({ price: 12.5, basePrice: 0 }) === '12,50 €', 'prix et prix de référence');
const NOTE_INTERNE = '[equipe] {"t":"Client pénible, à surveiller","par":"Seb","le":"2026-10-02T10:00:00.000Z"}';
const NOTES = `Allergie arachides (Noah).\n${NOTE_INTERNE}\nBougies : 9 ans.\n  [equipe] {"t":"seconde note interne"}`;
ok(feuille.notesImprimables(NOTES) === 'Allergie arachides (Noah).\nBougies : 9 ans.', 'les lignes « [equipe] » disparaissent, les autres restent');
ok(feuille.notesImprimables('[Equipe] x\n[équipe] y') === '', 'la marque est reconnue quelle que soit la casse ou l\u2019accent');
ok(feuille.filtrerReservationsDuJour([dossier({ status: 'cancelled' }), dossier({ validationStatus: 'rejected' }), dossier({ nom: 'Gardé' })], DATE).length === 1, 'annulés et refusés ne vont pas sur la feuille');
ok(feuille.blocDe('14:10') === 14 * 60 && feuille.blocDe('14:40') === 14 * 60 + 30 && feuille.blocDe('14:30') === 14 * 60 + 30, 'la demi-heure d\u2019un dossier est l\u2019arrondi vers le bas');
ok(feuille.expliquerDemande({ contactName: 'Julie', payload: { demande: { groupType: 'ecole', organisation: 'École de Bertrix', participants: 48, companions: 4, ages: ['7-12'], date: '2026-10-03', moment: 'apres-midi', formulas: [{ id: 'kfd', name: 'KIDS FUN DAY' }], activities: [{ id: 'bowling', name: 'Bowling', participants: 48, duration: 1 }], advice: true, budgetPerPerson: 18, invoice: true, vatNumber: 'BE0400.123.456' } }, message: 'En car vers 13h.' }).includes('48 joueurs') , 'sur mesure : l\u2019explication reprend la demande structurée');

// ---------------------------------------------------------------------------
section('2. Contre-preuves : une règle mutée fait échouer la table');
// ---------------------------------------------------------------------------
const mutants = {
  'bowling sans la durée': (r, c) => (c === 'bowling' || c === 'duckpin' ? feuille.texteCase(r, c).replace(/\s*\(.*\)$/, '') : feuille.texteCase(r, c)),
  'laser une seule croix': (r, c) => (c === 'lg' ? (feuille.texteCase(r, c) ? 'X' : '') : feuille.texteCase(r, c)),
  'bowling avec l\u2019heure': (r, c) => (c === 'bowling' && feuille.texteCase(r, c) ? `${r.startTime} ${feuille.texteCase(r, c)}` : feuille.texteCase(r, c)),
  'durée même pour 1 h': (r, c) => (c === 'bowling' && feuille.texteCase(r, c) === 'X' ? 'X (1h)' : feuille.texteCase(r, c)),
  'numéros de pistes': (r, c) => (c === 'bowling' && feuille.texteCase(r, c) ? 'P1-2' : feuille.texteCase(r, c)),
  'arcades avec les minutes': (r, c) => (c === 'arcades' && feuille.texteCase(r, c) ? '30\u2019' : feuille.texteCase(r, c)),
};
for (const [nom, mutant] of Object.entries(mutants)) ok(verifierTable(mutant).length > 0, `mutant « ${nom} » : la table le rejette`);
ok(feuille.notesImprimables(NOTES) !== NOTES, 'contre-preuve : un filtre identité serait rejeté');

// ---------------------------------------------------------------------------
section('3. Débordement d\u2019une demi-heure');
// ---------------------------------------------------------------------------
const PDFTOTEXT = outil('pdftotext');
const PDFTOPPM = outil('pdftoppm');
const PDFINFO = outil('pdfinfo');
function texteDuPdf(buffer, nom) {
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, buffer);
  return execFileSync(PDFTOTEXT, ['-layout', fichier, '-'], { timeout: 60000 }).toString('utf8');
}
function pagesDuPdf(buffer) {
  const m = /\/Count (\d+)/.exec(buffer.toString('latin1'));
  return m ? Number(m[1]) : 0;
}
ok(PDFTOTEXT && PDFTOPPM, `pdftotext et pdftoppm présents (${PDFTOTEXT || 'absent'}, ${PDFTOPPM || 'absent'})`);
const sept = Array.from({ length: 7 }, (_, i) => dossier({ nom: `Déborde ${i + 1}`, heure: '14:00', bowling: { lanes: 1, minutes: 60 } }));
const planSept = feuille.planifierGrille(sept);
ok(planSept.length === 3, `7 dossiers à 14H : toujours 3 pages de grille (${planSept.length})`);
const blocSept = planSept[0].blocs.find((b) => b.debut === 14 * 60);
ok(blocSept && blocSept.n === 8 && blocSept.resas.length === 7, `le bloc 14H grandit à 8 lignes (7 dossiers + 1 ligne vide), obtenu ${blocSept && blocSept.n}`);
ok(planSept[0].hauteurLigne >= feuille.HAUTEUR_LIGNE.min && planSept[0].hauteurLigne <= feuille.HAUTEUR_LIGNE.max, `la hauteur de ligne reste entre ${feuille.HAUTEUR_LIGNE.min} et ${feuille.HAUTEUR_LIGNE.max} mm (${planSept[0].hauteurLigne.toFixed(2)})`);
const pdfSept = feuille.construireFeuilleSecours(sept, OPTIONS);
const texteSept = PDFTOTEXT ? texteDuPdf(pdfSept, 'sept.pdf') : '';
ok(sept.every((r) => texteSept.includes(r.name)), 'les 7 dossiers sont tous imprimés');
const soixante = Array.from({ length: 60 }, (_, i) => dossier({ nom: `Foule ${String(i + 1).padStart(2, '0')}`, heure: '14:00', bowling: { lanes: 1, minutes: 60 } }));
const planSoixante = feuille.planifierGrille(soixante);
ok(planSoixante.length > 3 && planSoixante.some((p) => p.suite), `60 dossiers à 14H : la page continue (${planSoixante.length} pages de grille, dont des « suite »)`);
ok(planSoixante.every((p) => p.hauteurLigne >= feuille.HAUTEUR_LIGNE.min), 'jamais sous 3,1 mm par ligne');
const texteSoixante = PDFTOTEXT ? texteDuPdf(feuille.construireFeuilleSecours(soixante, OPTIONS), 'soixante.pdf') : '';
ok(soixante.every((r) => texteSoixante.includes(r.name)), 'les 60 dossiers sont tous imprimés');
const tot = dossier({ nom: 'Lève-tôt', heure: '09:15', bowling: { lanes: 1, minutes: 60 } });
const tard = dossier({ nom: 'Couche-tard', heure: '23:40', bowling: { lanes: 1, minutes: 60 } });
const planHors = feuille.planifierGrille([tot, tard]);
ok(planHors[0].blocs[0].debut === 9 * 60 && planHors[0].blocs[0].resas[0] === tot, 'un dossier avant 10H ouvre un bloc 9H sur la page 1');
ok(planHors[2].blocs[planHors[2].blocs.length - 1].debut === 23 * 60 + 30 && planHors[2].blocs[planHors[2].blocs.length - 1].resas[0] === tard, 'un dossier après 23H ferme la page 3 sur un bloc 23H30');

// ---------------------------------------------------------------------------
section('4. Le jour de fixture en PDF');
// ---------------------------------------------------------------------------
const avecNote = FIXTURE.map((r) => (r.name === 'Anniversaire de Noah' ? { ...r, notes: NOTES } : r));
const pdfJour = feuille.construireFeuilleSecours(avecNote, OPTIONS);
const texteJour = PDFTOTEXT ? texteDuPdf(pdfJour, 'jour.pdf') : '';
const pagesTexte = texteJour.split('\f').filter((p) => p.trim());
const pagesGrille = pagesTexte.filter((p) => /Page \d\/3 · /.test(p));
const pagesAnnexe = pagesTexte.filter((p) => /détails de chaque réservation/.test(p));
ok(pagesDuPdf(pdfJour) === pagesGrille.length + pagesAnnexe.length && pagesGrille.length === 3, `3 pages de grille + ${pagesAnnexe.length} page(s) d\u2019annexe = ${pagesDuPdf(pdfJour)} pages`);
if (PDFINFO) {
  const info = execFileSync(PDFINFO, [path.join(TMP, 'jour.pdf')], { timeout: 60000 }).toString();
  ok(Number((/Pages:\s+(\d+)/.exec(info) || [])[1]) === pagesDuPdf(pdfJour), 'pdfinfo compte les mêmes pages');
}
ok(/10H à 14H/.test(pagesGrille[0]) && /14H30 à 18H30/.test(pagesGrille[1]) && /19H à 23H/.test(pagesGrille[2]), 'les trois plages du papier : 10H-14H, 14H30-18H30, 19H-23H');
ok(['10H', '10H30', '14H', '14H30', '18H30', '19H', '23H'].every((h) => new RegExp(`^\\s*${h}\\b`, 'm').test(texteJour)), 'les étiquettes d\u2019heure sont celles du papier');
ok(/NOM\s+TEL\s+Formule\s+pers\s+Bowling \(pistes\)\s+Duckpin\s+LG\s+Pixel\s+Arcades\s+Golf\s+O\u2019Clock\s+Playgr\s+Billard/.test(pagesGrille[0]), 'les 13 colonnes, dans l\u2019ordre du papier');
ok(/Jour\s+Date/.test(pagesGrille[0]) && /Samedi\s+03\/10\/2026/.test(pagesGrille[0]), 'les boîtes Jour et Date, remplies');
ok(FIXTURE.every((r) => texteJour.includes(r.name)), 'les 26 dossiers sont tous sur la grille ou l\u2019annexe');
ok(pagesGrille.join('').includes('XXXXXXX') && pagesGrille.join('').includes('X (1h30)') && pagesGrille.join('').includes('XXXXX'), 'les croix des pistes et la durée 1h30 sont imprimées');
ok((pagesGrille.join('').match(/à confirmer/g) || []).length === 9, `9 dossiers portent « à confirmer » (${(pagesGrille.join('').match(/à confirmer/g) || []).length})`);
ok(/Neufchâteau/.test(texteJour) && /Hôtel/.test(texteJour) && /Léa/.test(texteJour) && /Espèces/.test(texteJour) && /réservations/.test(texteJour), 'les accents sortent dans le texte extrait');
ok(/\d+ €/.test(texteJour) && /au lieu de[\s\S]{0,300}?495 €\)/.test(texteJour), 'le signe € et le prix de référence sortent');
ok(texteJour.includes('Allergie arachides') && texteJour.includes('Bougies : 9 ans'), 'les notes du client sont dans l\u2019annexe');
ok(!texteJour.includes('[equipe]') && !texteJour.includes('pénible') && !texteJour.includes('seconde note interne') && !pdfJour.toString('latin1').includes('p\xE9nible'), 'une note interne « [equipe] » n\u2019est JAMAIS imprimée (ni dans le texte, ni dans le fichier)');
ok(/Feuille de secours Pinlane · imprimée le 05\/10\/2026 à 09:00 · 26 réservations · 369 personnes/.test(texteJour), 'le pied de page : imprimée le, N réservations, N personnes');
ok(/11:00-12:00 Bowling · 1 piste · 6 joueurs/.test(texteJour) && /partie 1\/2/.test(texteJour) && /Table anniversaire/.test(texteJour), 'l\u2019annexe : programme heure par heure, parties, activités sans colonne');
ok(/Tarif à l\u2019accueil/.test(texteJour), 'un prix inconnu se dit « Tarif à l\u2019accueil »');
ok(!/\b(1[0-9]|2[0-3]):[0-5][0-9]\b/.test(pagesGrille.join('').replace(/imprimée le [^\n]*/g, '')), 'aucune heure dans les cases de la grille (règle du patron)');
// Un dossier sur mesure : son explication est dans l'annexe.
const mesure = dossier({ nom: 'Mairie de Bertrix', heure: '15:00', bowling: { lanes: 3, minutes: 60 }, extra: { customRequest: { contactName: 'Julie Maréchal', message: 'Sortie des aînés, prévoir des chaises.', payload: { demande: { groupType: 'association', organisation: 'Mairie de Bertrix', participants: 20, moment: 'apres-midi', date: DATE, activities: [{ id: 'bowling', name: 'Bowling', participants: 20, duration: 1 }] } } } } });
const texteMesure = PDFTOTEXT ? texteDuPdf(feuille.construireFeuilleSecours([mesure], OPTIONS), 'mesure.pdf') : '';
ok(/Sur mesure/.test(texteMesure) && /Demande sur mesure/.test(texteMesure) && /prévoir des chaises/.test(texteMesure) && /20 joueurs/.test(texteMesure), 'sur mesure : « Sur mesure » dans la grille, la demande complète dans l\u2019annexe');
// La variante vierge.
const pdfVierge = feuille.construireFeuilleSecours(FIXTURE, { ...OPTIONS, vierge: true });
const texteVierge = PDFTOTEXT ? texteDuPdf(pdfVierge, 'vierge.pdf') : '';
ok(pagesDuPdf(pdfVierge) === 3 && !/Samedi|03\/10\/2026/.test(texteVierge) && /feuille vierge/.test(texteVierge) && !FIXTURE.some((r) => texteVierge.includes(r.name)), 'la feuille vierge : 3 pages, Jour et Date vides, aucun dossier');
// Le rendu.
if (PDFTOPPM) {
  const r = spawnSync(PDFTOPPM, ['-r', '50', '-png', path.join(TMP, 'jour.pdf'), path.join(TMP, 'jour')], { timeout: 120000, encoding: 'utf8' });
  const pngs = fs.readdirSync(TMP).filter((n) => /^jour-\d+\.png$/.test(n));
  const tailles = pngs.map((n) => fs.statSync(path.join(TMP, n)).size);
  const rendu = r.status === 0 && !/error|syntax/i.test(r.stderr || '') && pngs.length === pagesDuPdf(pdfJour) && tailles.every((t) => t > 2000);
  // (rouge, il dit pourquoi : le code, la taille de chaque image, ce que
  // pdftoppm a ecrit ; la premiere machine qui l avait l a vu rouge sans raison)
  ok(rendu, `pdftoppm rend les ${pagesDuPdf(pdfJour)} pages sans erreur (${pngs.length} PNG)${rendu ? '' : ` : code ${r.status}, ${tailles.join(' / ')} octets, « ${String(r.stderr || r.error || '').trim().slice(0, 400)} »`}`);
}
// Contre-preuves sur le texte : les contrôles ci-dessus savent échouer.
const controlesTexte = (texte) => [
  FIXTURE.every((r) => texte.includes(r.name)),
  !texte.includes('[equipe]') && !texte.includes('pénible'),
  (texte.match(/à confirmer/g) || []).length === 9,
  /Neufchâteau/.test(texte) && /€/.test(texte),
];
ok(controlesTexte(texteJour).every(Boolean), 'contre-preuve : les contrôles passent sur le vrai texte');
ok(!controlesTexte(texteJour.split('Scouts de Neufchâteau 2').join('Scouts de Neufchateau 2')).every(Boolean), 'contre-preuve : un dossier manquant ou un accent perdu fait échouer');
ok(!controlesTexte(`${texteJour}\n[equipe] fuite`).every(Boolean), 'contre-preuve : une note interne imprimée fait échouer');
ok(!controlesTexte(texteJour.replace('à confirmer', '')).every(Boolean), 'contre-preuve : une étiquette « à confirmer » perdue fait échouer');

// ---------------------------------------------------------------------------
section('5. L\u2019écrivain PDF');
// ---------------------------------------------------------------------------
const oct = pdfWriter.encoderWinAnsi('é€«»…ç\u2019A');
ok(oct[0] === 0xE9 && oct[1] === 0x80 && oct[2] === 0xAB && oct[3] === 0xBB && oct[4] === 0x85 && oct[5] === 0xE7 && oct[6] === 0x92 && oct[7] === 0x41, 'WinAnsi : é=E9, €=80, «=AB, »=BB, …=85, ç=E7, \u2019=92');
ok(pdfWriter.encoderWinAnsi('ő✓\u202F').toString('latin1') === 'o? ', 'hors table : lettre de base, « ? », espace fine -> espace');
ok(Math.abs(pdfWriter.largeurTexte('Bowling (pistes)', 'Helvetica', 7.6) - 19.37) < 0.05, `largeur AFM de « Bowling (pistes) » à 7,6 pt = 19,37 mm (${pdfWriter.largeurTexte('Bowling (pistes)', 'Helvetica', 7.6).toFixed(2)})`);
ok(Math.abs(pdfWriter.largeurTexte('XXXXXXX', 'Helvetica', 7.2) - 7 * 667 / 1000 * 7.2 / pdfWriter.MM) < 1e-9, '7 croix mesurent 7 fois la largeur AFM du X');
ok(pdfWriter.largeurTexte('Dupont', 'Helvetica-Bold', 9) > pdfWriter.largeurTexte('Dupont', 'Helvetica', 9), 'le gras est plus large que le normal');
const tronque = pdfWriter.ajusterTexte('Anniversaire de Noah et ses copains', 'Helvetica-Bold', 7.4, 30);
ok(tronque.endsWith('\u2026') && tronque.length < 35 && pdfWriter.largeurTexte(tronque, 'Helvetica-Bold', 7.4) <= 30, `troncature avec « … » dans 30 mm : « ${tronque} »`);
ok(pdfWriter.ajusterTexte('Dupont', 'Helvetica', 9, 30) === 'Dupont', 'un texte qui tient n\u2019est pas tronqué');
const lignes = pdfWriter.couperTexte('Facture au nom de Lambda SA, TVA BE0123.456.789.\nSupercalifragilisticexpialidocious', 'Helvetica', 7.5, 30);
ok(lignes.length >= 3 && lignes.every((l) => pdfWriter.largeurTexte(l, 'Helvetica', 7.5) <= 30 + 1e-9) && lignes.join(' ').includes('Supercalifragilistic'), `coupe en lignes de 30 mm, mot trop long coupé (${lignes.length} lignes)`);
const doc = new pdfWriter.PdfDocument({ titre: 'Essai' });
const page = doc.ajouterPage({ orientation: 'landscape' });
page.ligne(0, 0, 10, 10).rectangle(1, 1, 5, 5, { fond: 0.5, contour: 0 }).texte('Bonjour (é) \\ €', 2, 2, { police: 'bold' });
const buf = doc.versBuffer();
const s = buf.toString('latin1');
ok(s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n'), 'en-tête %PDF-1.4 et %%EOF');
ok(/MediaBox \[0 0 841\.89 595\.276\]/.test(s), 'A4 paysage = 841,89 x 595,28 pt');
const xi = s.indexOf('\nxref\n') + 1;
const lignesXref = s.slice(xi).split('\n');
const nObj = Number(lignesXref[1].split(' ')[1]);
let xrefOk = nObj === 8;
for (let i = 1; i < nObj; i += 1) { const off = Number(lignesXref[2 + i].slice(0, 10)); if (lignesXref[2 + i].length !== 19 || !s.slice(off).startsWith(`${i} 0 obj`)) xrefOk = false; }
const startxref = Number(s.slice(s.lastIndexOf('startxref')).trim().split('\n')[1]);
ok(xrefOk && startxref === xi, 'table xref : chaque offset tombe sur son objet, startxref sur la table');
const flux = /stream\n([\s\S]*?)\nendstream/.exec(s);
const contenu = zlib.inflateSync(Buffer.from(flux[1], 'latin1')).toString('latin1');
ok(/BT \/F2 9 Tf/.test(contenu) && /\(Bonjour \\\(\\351\\\) \\\\ \\200\) Tj/.test(contenu) && / re B/.test(contenu) && / l S/.test(contenu), 'flux dégonflé : texte échappé en octal WinAnsi, rectangle plein, trait');
if (PDFTOTEXT) ok(texteDuPdf(buf, 'essai.pdf').includes('Bonjour (é) \\ €'), 'pdftotext relit le texte avec ses accents et le €');

// ---------------------------------------------------------------------------
section('6. Le classeur Excel');
// ---------------------------------------------------------------------------
const DEMANDES = [{
  id: 41, contactName: 'Julie Maréchal', company: 'École communale de Bertrix', email: 'julie@ecole-bertrix.be', phone: '+32 61 41 12 34', requestedDate: DATE, pax: 48, occasion: 'ecole', message: 'En car vers 13h.', source: 'client', status: 'in_progress',
  payload: { demande: { groupType: 'ecole', groupTypeLabel: 'École, jeunesse', organisation: 'École communale de Bertrix', participants: 48, companions: 4, ages: ['7-12'], flexible: false, date: DATE, alternativeDate: '2026-10-10', moment: 'apres-midi', momentLabel: 'Après-midi', formulas: [{ id: 'kfd', name: 'KIDS FUN DAY' }], activities: [{ id: 'bowling', name: 'Bowling', participants: 48, duration: 1 }], advice: true, budgetPerPerson: 18, contactRole: 'Institutrice', invoice: true, vatNumber: 'BE0400.123.456' },
    suivi: { historique: [{ type: 'prise-en-charge', le: '2026-10-01T08:12:00Z', par: 'Seb' }, { type: 'reponse', le: '2026-10-01T09:40:00Z', par: 'Seb', objet: 'Votre sortie', communicationId: 912, source: 'ia' }], notes: [{ le: '2026-10-01T08:15:00Z', par: 'Seb', texte: 'Demander si les accompagnants mangent.' }] } },
  createdAt: '2026-09-30T16:20:00Z', updatedAt: '2026-10-01T09:41:00Z',
}];
const HISTORIQUE = [{ quand: '2026-10-02T14:03:00Z', qui: 'Seb', action: 'Prix adapté', avant: { price: 495 }, après: { price: 280 } }];
const xlsx = exportExcel.construireClasseurJour(avecNote, { date: DATE, centreNom: 'Fun Galaxy Libramont', formules: FORMULES, demandesSurMesure: DEMANDES, historique: HISTORIQUE, genereLe: '05/10/2026 à 09:00' });
const xlsxVide = exportExcel.construireClasseurJour([], { date: DATE, centreNom: 'Fun Galaxy Libramont', formules: FORMULES, genereLe: '05/10/2026 à 09:00' });
ok(xlsx.readUInt32LE(0) === 0x04034b50, 'le classeur commence par une entrée zip');
const entrees = xlsxWriter.lireZip(xlsx);
const parNomZip = Object.fromEntries(entrees.map((e) => [e.nom, e.donnees.toString('utf8')]));
ok(entrees.length === 13 && entrees.every((e) => e.crcOk) && entrees[0].nom === '[Content_Types].xml', `zip valide : ${entrees.length} entrées, CRC exacts, [Content_Types].xml en premier`);
ok(xlsxWriter.crc32(Buffer.from('123456789')) === 0xCBF43926, 'CRC-32 de « 123456789 » = CBF43926 (vecteur de référence)');
if (outil('unzip')) { const u = spawnSync('unzip', ['-tq', (() => { const p = path.join(TMP, 'jour.xlsx'); fs.writeFileSync(p, xlsx); return p; })()], { encoding: 'utf8', timeout: 60000 }); ok(u.status === 0 && /No errors/.test(u.stdout), 'unzip -t : aucune erreur'); }
// XML bien formé : contrôle maison (équilibre des balises, attributs cités,
// entités connues), et xmllint s'il est là.
function xmlBienForme(texte) {
  if (!/^<\?xml version="1\.0" encoding="UTF-8"/.test(texte)) return 'pas de prologue';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(texte)) return 'caractère de contrôle';
  const corps = texte.replace(/^<\?xml[^>]*\?>\s*/, '');
  const pile = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(corps))) {
    if (m[6]) return `« < » inattendu à ${m.index}`;
    if (m[5]) { if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(m[5])) return `entité inconnue dans « ${m[5].slice(0, 30)} »`; continue; }
    if (m[1]) { if (pile.pop() !== m[2]) return `fermeture inattendue </${m[2]}>`; } else if (!m[4]) pile.push(m[2]);
  }
  return pile.length ? `balises ouvertes : ${pile.join(',')}` : '';
}
const malFormes = entrees.map((e) => ({ nom: e.nom, erreur: xmlBienForme(e.donnees.toString('utf8')) })).filter((x) => x.erreur);
ok(malFormes.length === 0, `les 13 parties XML sont bien formées${malFormes.length ? ` : ${malFormes.map((x) => `${x.nom} (${x.erreur})`).join(' ; ')}` : ''}`);
ok(xmlBienForme('<?xml version="1.0" encoding="UTF-8"?><a><b></a>') && xmlBienForme('<?xml version="1.0" encoding="UTF-8"?><a>x & y</a>') && !xmlBienForme('<?xml version="1.0" encoding="UTF-8"?><a b="1"><c/>x &amp; y</a>'), 'contre-preuve : le contrôle XML rejette une balise non fermée et un « & » nu');
const XMLLINT = outil('xmllint');
if (XMLLINT) {
  let lintOk = true;
  for (const e of entrees) { const p = path.join(TMP, e.nom.replace(/[\\/\[\]]/g, '_')); fs.writeFileSync(p, e.donnees); if (spawnSync(XMLLINT, ['--noout', p], { timeout: 60000 }).status !== 0) lintOk = false; }
  ok(lintOk, 'xmllint valide chaque partie');
}
const workbook = parNomZip['xl/workbook.xml'];
ok(exportExcel.NOMS_FEUILLES.every((n) => workbook.includes(`<sheet name="${n}"`)), `les 5 feuilles : ${exportExcel.NOMS_FEUILLES.join(', ')}`);
const sst = parNomZip['xl/sharedStrings.xml'];
const chaines = [...sst.matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map((x) => x[1]);
const enteteResas = ['Heure', 'Client', 'Téléphone', 'E-mail', 'Formule', 'Pers.', 'Bowling (pistes)', 'Duckpin', 'LG', 'Pixel', 'Arcades', 'Golf', 'O\u2019Clock', 'Playgr', 'Billard', 'Prix', 'Payé', 'Statut', 'Canal', 'Notes', 'Référence'];
ok(enteteResas.every((t) => chaines.includes(t)), 'l\u2019en-tête de « Réservations » est complet');
ok(['Heure début', 'Heure fin', 'Activité', 'Pistes / parties', 'Joueurs'].every((t) => chaines.includes(t)), 'l\u2019en-tête de « Programme détaillé »');
ok(['Reçue le', 'Type de groupe', 'Participants', 'Budget par personne', 'Suivi', 'Message du client'].every((t) => chaines.includes(t)), 'l\u2019en-tête de « Demandes sur mesure »');
ok(['Quand', 'Qui', 'Action', 'Avant', 'Après'].every((t) => chaines.includes(t)), 'l\u2019en-tête de « Historique »');
const sheet2 = parNomZip['xl/worksheets/sheet2.xml'];
const ligne2 = /<row r="2">([\s\S]*?)<\/row>/.exec(sheet2)[1];
const cellules2 = [...ligne2.matchAll(/<c r="([A-Z]+)2"([^>]*)>(?:<v>([^<]*)<\/v>)?/g)].map((x) => ({ col: x[1], attrs: x[2], v: x[3] }));
const cellule = (col) => cellules2.find((c) => c.col === col);
ok(cellule('A') && !/t="s"/.test(cellule('A').attrs) && Math.abs(Number(cellule('A').v) - 11 / 24) < 1e-9, 'l\u2019heure 11:00 est un nombre Excel (11/24)');
ok(cellule('F') && !/t="s"/.test(cellule('F').attrs) && cellule('F').v === '6', 'les personnes sont un nombre');
ok(cellule('P') && !/t="s"/.test(cellule('P').attrs) && cellule('P').v === '39', 'le prix est un nombre (pas du texte)');
ok(/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(sheet2) && /<autoFilter ref="A1:W27"\/>/.test(sheet2), 'ligne d\u2019en-tête figée et filtre automatique sur A1:W27');
ok(/_xlnm\._FilterDatabase/.test(workbook), 'le filtre est déclaré dans le classeur (Excel le reconnaît)');
const styles = parNomZip['xl/styles.xml'];
ok(/formatCode="#,##0\.00\\ &quot;€&quot;"/.test(styles) && /formatCode="dd\/mm\/yyyy"/.test(styles) && /formatCode="hh:mm"/.test(styles), 'formats monétaire « #,##0.00 € », date et heure');
ok(/<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"\/>/.test(styles) && /<b\/>/.test(styles) && /style="thin"/.test(styles) && /wrapText="1"/.test(styles), 'en-tête gras sur fond coloré, bordures fines, retour à la ligne');
ok(chaines.some((t) => t === 'XXXXXXX') && chaines.some((t) => t === 'X (1h30)') && chaines.some((t) => t === 'XX'), 'les cases d\u2019activité suivent les mêmes règles que le papier');
ok(chaines.includes('Allergie arachides (Noah).\nBougies : 9 ans.') && !sst.includes('[equipe]') && !sst.includes('pénible'), 'la note interne n\u2019est pas dans le classeur, la note du client oui');
ok(chaines.includes('En cours') && chaines.includes('Julie Maréchal') && chaines.some((t) => /Prise en charge · Seb/.test(t) && /Réponse envoyée : Votre sortie/.test(t)) && chaines.some((t) => /Demander si les accompagnants mangent/.test(t)), 'la demande sur mesure : tous ses champs et son suivi');
ok(chaines.includes('Prix adapté') && chaines.includes('price : 495') && chaines.includes('price : 280'), 'l\u2019historique : qui, quoi, avant, après');
ok(!chaines.includes('Aucune demande sur mesure.') && !chaines.includes('Aucune modification enregistrée.'), 'pas de ligne d\u2019état vide quand il y a des données');
const chainesVide = [...xlsxWriter.lireZip(xlsxVide).find((e) => e.nom === 'xl/sharedStrings.xml').donnees.toString('utf8').matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map((x) => x[1]);
ok(['Aucune réservation ce jour-là.', 'Aucune activité planifiée ce jour-là.', 'Aucune demande sur mesure.', 'Aucune modification enregistrée.'].every((t) => chainesVide.includes(t)), 'classeur sans données : une ligne d\u2019état vide par feuille');
// Contre-preuve : un zip corrompu est rejeté.
const corrompu = Buffer.from(xlsx);
corrompu[corrompu.readUInt32LE(corrompu.length - 6)] ^= 0xFF; // la signature du répertoire central
let rejet = false;
try { xlsxWriter.lireZip(corrompu); } catch (e) { rejet = true; }
ok(rejet, 'contre-preuve : un répertoire central corrompu est rejeté');
const crcFaux = Buffer.from(xlsx);
crcFaux[30 + '[Content_Types].xml'.length + 5] ^= 0x01; // un octet du corps de la première entrée
ok((() => { try { return xlsxWriter.lireZip(crcFaux).some((e) => !e.crcOk); } catch (e) { return true; } })(), 'contre-preuve : un octet modifié casse le CRC (ou le dégonflage)');
// LibreOffice.
const SOFFICE = outil('soffice') || outil('libreoffice');
if (SOFFICE) {
  const fichier = path.join(TMP, 'classeur.xlsx');
  fs.writeFileSync(fichier, xlsx);
  const sortie = path.join(TMP, 'lo');
  fs.mkdirSync(sortie, { recursive: true });
  const r = spawnSync(SOFFICE, ['--headless', `-env:UserInstallation=file://${path.join(TMP, 'lo-profile')}`, '--convert-to', 'pdf', '--outdir', sortie, fichier], { encoding: 'utf8', timeout: 240000 });
  const pdfLo = path.join(sortie, 'classeur.pdf');
  const converti = r.status === 0 && fs.existsSync(pdfLo) && fs.statSync(pdfLo).size > 1000;
  if (!converti && /source file could not be loaded/.test(`${r.stdout}${r.stderr}`)) {
    console.log('warn  LibreOffice est là mais sans le module Calc (libreoffice-calc) : conversion NON VÉRIFIÉE');
  } else {
    ok(converti, `LibreOffice convertit le classeur en PDF sans erreur (${(r.stderr || '').split('\n').filter((l) => l && !/javaldx/.test(l)).join(' ') || 'rien sur stderr'})`);
    if (converti && PDFTOTEXT) {
      const texteLo = execFileSync(PDFTOTEXT, ['-layout', pdfLo, '-'], { timeout: 60000 }).toString('utf8');
      ok(/Fun Galaxy Libramont/.test(texteLo) && /Scouts de Neufchâteau/.test(texteLo) && /XXXXXXX/.test(texteLo) && /Julie Maréchal/.test(texteLo) && /Prix adapté/.test(texteLo), 'le PDF de LibreOffice contient les cinq feuilles');
      ok(/39\.00 €|39,00 €/.test(texteLo) && /03\/10\/2026/.test(texteLo) && /11:00/.test(texteLo), 'LibreOffice affiche les montants, dates et heures formatés');
    }
  }
} else {
  console.log('warn  soffice absent : conversion LibreOffice NON VÉRIFIÉE');
}
// openpyxl, lecteur indépendant, s'il est installé.
const PY = outil('python3');
if (PY) {
  const script = 'import sys, openpyxl\nwb = openpyxl.load_workbook(sys.argv[1])\nws = wb["Réservations"]\nprint("|".join(wb.sheetnames), ws.freeze_panes, ws.auto_filter.ref, ws["P2"].value, ws["P2"].number_format, type(ws["A2"].value).__name__)';
  const r = spawnSync(PY, ['-c', script, (() => { const p = path.join(TMP, 'jour2.xlsx'); fs.writeFileSync(p, xlsx); return p; })()], { encoding: 'utf8', timeout: 60000 });
  if (r.status === 0) ok(/^Résumé\|Réservations\|Programme détaillé\|Demandes sur mesure\|Historique A2 A1:W27 39 #,##0\.00\\ "€" time$/.test(r.stdout.trim()), `openpyxl relit le classeur : ${r.stdout.trim()}`);
  else console.log('warn  openpyxl absent : second lecteur NON VÉRIFIÉ');
}

console.log(`\n${echecs ? 'FAIL' : 'OK'}  documents-secours : ${reussites} contrôles passés, ${echecs} échec(s)`);
process.exitCode = echecs ? 1 : 0;
