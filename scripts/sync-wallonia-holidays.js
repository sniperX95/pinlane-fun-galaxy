// RECOPIE LE CALENDRIER SCOLAIRE OFFICIEL DANS LA TABLE DE RESERVE.
//
// Le serveur relit deja OpenHolidays a chaud (lib/booking-config.js,
// refreshWalloniaSchoolHolidays). Ce script fait la meme lecture, puis reecrit
// WALLONIA_SCHOOL_HOLIDAYS dans lib/booking-config.js : la reserve suit ainsi
// les annees publiees, et le gate test:wallonia-calendar cesse de reclamer.
// Union avec la table existante (par date de debut) : rien n est retire.
//
// Usage : npm run sync:calendar        (puis relire le diff et commiter)
'use strict';
const fs = require('fs');
const path = require('path');
const { parseOpenHolidaysSchoolEntries, WALLONIA_SCHOOL_HOLIDAYS, todayStr } = require('../lib/booking-config');

const FICHIER = path.join(__dirname, '..', 'lib', 'booking-config.js');
const URL_API = 'https://openholidaysapi.org/SchoolHolidays';

function plusJours(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function anneeScolaire(range) {
  const [y, m] = range.start.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

(async () => {
  const today = todayStr();
  const from = plusJours(today, -400);
  const to = plusJours(today, 800);
  const url = `${URL_API}?countryIsoCode=BE&languageIsoCode=FR&validFrom=${from}&validTo=${to}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`OpenHolidays HTTP ${response.status}`);
  const lues = parseOpenHolidaysSchoolEntries(await response.json());
  if (!lues.length) throw new Error('aucune periode BE-FR lue : table laissee telle quelle');

  const parDebut = new Map();
  WALLONIA_SCHOOL_HOLIDAYS.forEach((r) => parDebut.set(r.start, { ...r }));
  let ajoutees = 0;
  let changees = 0;
  lues.forEach((r) => {
    const avant = parDebut.get(r.start);
    if (!avant) ajoutees += 1;
    else if (avant.end !== r.end || avant.label !== r.label || avant.kind !== r.kind) changees += 1;
    parDebut.set(r.start, { ...r });
  });
  const table = [...parDebut.values()].sort((a, b) => (a.start < b.start ? -1 : 1));

  const source = fs.readFileSync(FICHIER, 'utf8');
  const debut = source.indexOf('const WALLONIA_SCHOOL_HOLIDAYS = [');
  const fin = source.indexOf('];', debut);
  if (debut < 0 || fin < 0) throw new Error('table introuvable dans lib/booking-config.js');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lignes = ['const WALLONIA_SCHOOL_HOLIDAYS = ['];
  let anneeCourante = null;
  table.forEach((r) => {
    const annee = anneeScolaire(r);
    if (annee !== anneeCourante) { lignes.push(`  // Annee scolaire ${annee}-${annee + 1}`); anneeCourante = annee; }
    const label = r.label.includes("'") ? `"${r.label}"` : `'${r.label}'`;
    lignes.push(`  { start: '${r.start}', end: '${r.end}', label: ${label}, kind: '${r.kind}' },`);
  });
  lignes.push('];');
  const bloc = lignes.join(eol);
  const nouveau = source.slice(0, debut) + bloc + source.slice(fin + 2);
  // Les deux tirets sont ecrits en echappement unicode : le gate no-em-dash
  // lit ce fichier aussi.
  if (/[—–]/.test(bloc)) throw new Error('tiret cadratin dans la table');
  fs.writeFileSync(FICHIER, nouveau);
  console.log(`sync-wallonia-holidays : ${lues.length} periode(s) lue(s) (${from} a ${to}), ${ajoutees} ajoutee(s), ${changees} modifiee(s), table de ${table.length} periode(s), couverture jusqu au ${table[table.length - 1].end}.`);
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
