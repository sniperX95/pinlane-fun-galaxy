// UN RAPPEL NE PROMET QUE CE QUI EST VRAI.
//
// Le rappel J-2 dit au client, mot pour mot : "on vous attend a 15:00 chez
// Fun Galaxy Libramont, et tout est deja bloque a votre nom".
//
// DEUX DEFAUTS MESURES LE 2026-08-31.
//
// 1. IL PARTAIT SUR UNE RESERVATION QUE PERSONNE N AVAIT VALIDEE. Une
//    reservation en validationStatus 'staff_review' (le moteur n a pas trouve
//    de plan sur, un humain doit trancher) recevait quand meme ce rappel : il
//    etait enfile SANS aucune condition sur validationMode, contrairement a
//    request_received / confirmation et a staff_review_request, qui la
//    verifient tous. Si personne ne traite le dossier avant J-2, le client
//    recoit la promesse, se presente, et rien n est reserve a son nom.
//
// 2. IL OUBLIAIT L HEURE DE LA DEUXIEME ACTIVITE. Sur une formule
//    bowling + laser, le mail de CONFIRMATION ecrit bien "Vos rendez-vous :
//    Bowling 15:00, Laser Game 18:00" (buildFormulaEngagementLines). Le rappel
//    J-2, lui, ne repetait que l heure d arrivee : le client relit son dernier
//    mail la veille et croit que tout s enchaine a partir de 15:00.
//
// Trois proprietes :
//   A. staff_review : AUCUN rappel J-2 enfile (mais le dossier recoit bien son
//      accuse de reception et la demande de validation au staff).
//   B. confirme : le rappel J-2 est enfile, comme avant.
//   C. formule bowling + laser : le rappel repete les rendez-vous, heure du
//      laser comprise.
//
// Contre-epreuve par mutation : on retire la condition de validation, on
// prouve que le gate rougit, on restaure.
//
// Lancement : node scripts/reminder-truth-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const COMMS = path.join(ROOT, 'lib/ops-communications.js');

function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
// La file est en memoire : on mesure CE QUI EST ENFILE, pas le stockage.
const FILE = [];
mock('lib/database', {
  getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }),
  createCommunication: async (row) => { FILE.push(row); return { ...row, id: FILE.length }; },
  listCommunications: async () => FILE,
  updateCommunication: async () => ({}),
  readStaffState: async () => ({ reservations: [], laneStatuses: {}, blocks: [] }),
  createOpsEvent: async () => ({}),
});

const comms = require(COMMS);

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

function dansDeuxSemaines() {
  const c = new Date();
  c.setDate(c.getDate() + 14);
  return c.toISOString().slice(0, 10);
}
const DATE = dansDeuxSemaines();

function reservation(extra = {}) {
  return {
    id: 4242,
    centerId: 'libramont',
    name: 'Client Test',
    email: 'client@exemple.be',
    phone: '+32470000000',
    date: DATE,
    startTime: '15:00',
    duration: 1,
    totalDuration: 1,
    pax: 8,
    type: 'bowling',
    formuleId: '',
    lanes: [1],
    price: 39,
    validationStatus: 'confirmed',
    opsPlan: null,
    ...extra,
  };
}

const FORMULE = reservation({
  type: 'formule',
  formuleId: 'f1',
  totalDuration: 4,
  opsPlan: {
    startTime: '15:00',
    arrivalMinutes: 10,
    resourceBlocks: [
      { resourceType: 'bowling_lane', startTime: '15:00', endTime: '16:00' },
      { resourceType: 'laser_arena', startTime: '18:00', endTime: '18:25' },
      { resourceType: 'laser_arena', startTime: '18:30', endTime: '18:55' },
    ],
  },
});

async function enfilees(res) {
  FILE.length = 0;
  await comms.enqueueReservationCommunications(res, {});
  return FILE.map((c) => String(c.templateId || ''));
}

async function main() {
  // --- A. Une reservation non validee ne recoit pas la promesse -----------
  const enAttente = await enfilees(reservation({ validationStatus: 'staff_review' }));
  ok(!enAttente.includes('reminder_48h'),
    `staff_review : aucun rappel J-2 enfile (enfiles : ${enAttente.join(', ') || 'aucun'})`);
  ok(enAttente.includes('request_received'),
    `staff_review : le client recoit bien son accuse de reception (${enAttente.join(', ') || 'aucun'})`);

  // --- B. Une reservation confirmee garde son rappel ----------------------
  const confirmee = await enfilees(reservation({ validationStatus: 'confirmed' }));
  ok(confirmee.includes('reminder_48h'),
    `confirmee : le rappel J-2 est toujours enfile (${confirmee.join(', ') || 'aucun'})`);
  ok(confirmee.includes('confirmation'),
    `confirmee : la confirmation part aussi (${confirmee.join(', ') || 'aucun'})`);

  // --- C. Le rappel repete les rendez-vous d une formule ------------------
  const confirmation = comms.buildMessage({ reservation: FORMULE, templateId: 'confirmation', channel: 'email' });
  ok(/18:00/.test(String(confirmation.body || '')),
    "la confirmation dit deja l heure du laser (repere : elle n a jamais eu ce defaut)");

  const rappel = comms.buildMessage({ reservation: FORMULE, templateId: 'reminder_48h', channel: 'email' });
  const corps = String(rappel.body || '');
  ok(/18:00/.test(corps),
    `le rappel J-2 repete l heure du laser (extrait : ${corps.replace(/\s+/g, ' ').slice(0, 120)})`);
  ok(/15:00/.test(corps),
    "le rappel J-2 garde l heure d arrivee");

  if (failures) {
    console.error(`\nreminder-truth-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\nreminder-truth-check: ALL OK (rien de promis sans validation, et les rendez-vous sont repetes)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(COMMS, 'utf8');
  const marqueur = "validationMode !== 'staff_review' && wantsTemplate('reminder_48h')";
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : la condition de validation est introuvable dans lib/ops-communications.js');
    process.exit(1);
  }
  const mute = source.replace(marqueur, "wantsTemplate('reminder_48h')");
  fs.writeFileSync(COMMS, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(COMMS, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans la condition de validation.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans la condition, le rappel repart sur un dossier non valide et le gate rougit.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
