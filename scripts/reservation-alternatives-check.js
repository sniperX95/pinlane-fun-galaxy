#!/usr/bin/env node
'use strict';
// =============================================================================
// LE CLIENT QUI PERD LA DERNIERE PISTE SE VOIT PROPOSER SA JOURNEE (2026-09-29)
// -----------------------------------------------------------------------------
// Campagne de reservations sur banc local : deux clients voient 16:00 libre
// pour la derniere piste d un samedi, les deux valident. Le premier passe, le
// second lit « Ce creneau ne peut plus etre reserve en ligne. Autres
// possibilites : Dim. 11 oct. a 16:00, 16:30, 17:00 », alors que son samedi
// avait encore de la place a 14:30 ou 19:30. Le formulaire envoie les heures
// de son plan (preference.preferredTimes) ; la recherche d alternatives les
// gardait pour chaque candidat, donc toute la journee demandee echouait sur
// la piste deja prise, et seul le lendemain a la meme heure passait.
//
//   [A] une visite dont l heure posee vient d etre prise recoit d abord des
//       alternatives LE MEME JOUR, jamais a l heure prise ;
//   [B] chacune tient vraiment : son plan de pistes ne chevauche pas l heure
//       pleine ;
//   [C] une demande sans heure posee se comporte comme avant.
//   [E] contre-epreuve : sans la variante « horaires adaptes », la premiere
//       alternative repart au lendemain, ce gate ROUGIT.
//
// Aucune base, aucun envoi : les dossiers du jour sont en memoire.
// =============================================================================
const fs = require('fs');
const path = require('path');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.RESEND_API_KEY;
process.env.PINLANE_CALENDAR_SYNC = 'off';

const ROOT = path.join(__dirname, '..');
const CENTRE = 'libramont';
let echecs = 0;
function ok(cond, label, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) echecs += 1;
  return Boolean(cond);
}

// Un samedi dans deux semaines, au fuseau du centre : jamais « aujourd hui ».
function samediDansDeuxSemaines() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d + 7));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const SAMEDI = samediDansDeuxSemaines();

// Les huit pistes prises de 16:00 a 17:00, une par groupe de 5.
const DOSSIERS = Array.from({ length: 8 }, (_, k) => ({
  id: 7001 + k, centerId: CENTRE, date: SAMEDI, startTime: '16:00', duration: 1, totalDuration: 1, pax: 5,
  lanes: [k + 1], laneCount: 1, status: 'confirmed', validationStatus: 'confirmed', type: 'bowling', program: null, opsPlan: null,
}));

function charger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  const database = require(path.join(ROOT, 'lib/database.js'));
  const duJour = (date) => DOSSIERS.filter((r) => r.date === date);
  database.readStaffState = async (date, centerId = CENTRE) => ({ date, centerId, reservations: duJour(date), laneStatuses: [], laneMaintenance: {} });
  database.readAvailabilitySnapshot = async (date, centerId = CENTRE) => ({ date, centerId, reservations: duJour(date), laneStatuses: {}, blocks: [] });
  return require(path.join(ROOT, 'lib/reservation-alternatives.js'));
}

const demande = (preference) => ({
  centerId: CENTRE, date: SAMEDI, startTime: '16:00', pax: 4, name: 'Course B', phone: '+32491000000', email: 'course-b@example.org',
  channel: 'public', type: 'visite', program: [{ activityId: 'bowling', duration: 1 }],
  ...(preference ? { preference } : {}),
});
const POSEE = { preferredTimes: { bowling: '16:00' }, laserGameTimes: [], laserPlacement: 'scheduled', arrivalConfidence: 'normal' };
const OPTIONS = { channel: 'public', limit: 5, spanDays: 14, maxChecks: 160 };

const minutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function pistesDe(alternative) {
  return ((alternative.opsPlan && alternative.opsPlan.resourceBlocks) || []).filter((b) => b.resourceType === 'bowling_lane');
}
const chevauchePleine = (bloc) => minutes(bloc.startTime) < minutes('17:00') && minutes('16:00') < minutes(bloc.endTime);

async function main() {
  const { findReservationAlternatives } = charger();
  const posee = await findReservationAlternatives(demande(POSEE), OPTIONS);
  const libre = await findReservationAlternatives(demande(null), OPTIONS);
  const resume = (liste) => liste.map((a) => `${a.date} ${a.startTime}`).join(' | ');

  console.log(`[date] ${SAMEDI}, huit pistes prises de 16:00 a 17:00`);
  ok(posee.length > 0, 'MONTAGE : la visite de 16:00 recoit des alternatives', resume(posee));
  ok(posee.length > 0 && posee[0].date === SAMEDI && posee[0].startTime !== '16:00',
    '[A] l heure posee vient d etre prise : la premiere alternative est LE MEME JOUR, a une autre heure', resume(posee));
  const memeJour = posee.filter((a) => a.date === SAMEDI);
  const blocs = memeJour.flatMap(pistesDe);
  ok(memeJour.length > 0 && memeJour.every((a) => pistesDe(a).length > 0) && !blocs.some(chevauchePleine),
    '[B] chaque alternative du jour tient : ses pistes ne touchent pas l heure pleine', blocs.map((b) => `${b.startTime}-${b.endTime} p${(b.lanes || []).join(',')}`).join(' | '));
  ok(libre.length > 0 && libre[0].date === SAMEDI,
    '[C] une demande sans heure posee trouve aussi sa journee', resume(libre));

  // [E] LA CONTRE-EPREUVE : la variante retiree, sur une copie du module.
  const fichier = path.join(ROOT, 'lib/reservation-alternatives.js');
  const original = fs.readFileSync(fichier, 'utf8');
  const ancre = '    if (posees) {';
  const n = original.split(ancre).length - 1;
  if (ok(n === 1, 'contre-epreuve montable : la variante « horaires adaptes » une seule fois', `${n} occurrence(s)`)) {
    let casse = [];
    try {
      fs.writeFileSync(fichier, original.split(ancre).join('    if (false) {'));
      casse = await charger().findReservationAlternatives(demande(POSEE), OPTIONS);
    } finally {
      fs.writeFileSync(fichier, original);
      charger();
    }
    ok(!(casse.length > 0 && casse[0].date === SAMEDI), 'sans la variante, la premiere alternative repart au lendemain : ce gate ROUGIRAIT', resume(casse));
    ok(fs.readFileSync(fichier, 'utf8') === original, 'lib/reservation-alternatives.js restaure a l identique');
  }

  console.log(`\n${echecs === 0 ? 'reservation-alternatives-check: ALL OK' : `reservation-alternatives-check: ${echecs} echec(s)`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
