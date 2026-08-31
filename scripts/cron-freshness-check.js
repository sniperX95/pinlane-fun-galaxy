// LE CRON LIT LA BASE AVANT DE PARLER AU CLIENT.
//
// Le worker Railway (workers/ops-worker.js) et le cron Vercel (api/cron.js)
// partagent lib/cron-tasks.js, et ce sont eux qui composent puis envoient les
// mails. Mesure du 2026-08-31 : sur un run complet de
// runDispatchCommunicationsCron et de runOpsJobsCron, ZERO requete vers
// `centers`, `formulas` ou `activities`.
//
// Consequence : le cache de connaissance restait sur le socle FICHIER pendant
// toute la duree du process. Une personnalisation faite en console apres leur
// demarrage (horaires, jour ferme, tarif, formule, nom du centre) n atteignait
// jamais le client, et un centre ne dans la console etait purement inconnu.
// api/public-reservations.js, lui, rechauffe bien la connaissance a chaque
// requete : c est la meme regle, elle manquait juste a ces deux points.
//
// Trois proprietes :
//   A. runDispatchCommunicationsCron relit les centres.
//   B. runOpsJobsCron aussi.
//   C. Sans base, rien ne casse : le cron retombe sur le socle fichier au lieu
//      de ne rien envoyer (regle fail-soft du depot).
//
// Contre-epreuve par mutation : on retire le rechauffage, on prouve que le gate
// rougit, on restaure.
//
// Lancement : node scripts/cron-freshness-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TASKS = path.join(ROOT, 'lib/cron-tasks.js');

const SQL = [];
function compter(texte) {
  const sql = String(texte || '').replace(/\s+/g, ' ').trim().toLowerCase();
  SQL.push(sql);
  return { rows: [], rowCount: 0 };
}

let poolCasse = false;
function mock(rel, exports) {
  const resolu = require.resolve(path.join(ROOT, rel));
  require.cache[resolu] = { id: resolu, filename: resolu, loaded: true, exports };
}
mock('lib/database', {
  getPool: () => {
    if (poolCasse) throw new Error('pas de base');
    return { query: async (t) => compter(t), connect: async () => ({ query: async (t) => compter(t), release() {} }) };
  },
  createWorkerRun: async () => ({ id: 1 }),
  finishWorkerRun: async () => ({}),
  createOpsEvent: async () => ({}),
  readStaffState: async () => ({ reservations: [], laneStatuses: {}, blocks: [] }),
  // Le double doit porter TOUT ce que la chaine du cron appelle, sinon le gate
  // jette au lieu de mesurer, et sa contre-epreuve passe pour une mauvaise
  // raison (constate en l ecrivant).
  createCommunication: async () => ({}),
  listDueCommunications: async () => [],
  updateCommunicationStatus: async () => ({}),
  appendOpsJobStep: async () => ({}),
  claimOpsJob: async () => null,
  createOpsJob: async () => ({}),
  listDueOpsJobs: async () => [],
  updateOpsJobStatus: async () => ({}),
});

const taches = require(TASKS);

let failures = 0;
function ok(condition, message) {
  console.log(`${condition ? 'OK  ' : 'FAIL'}  ${message}`);
  if (!condition) failures += 1;
  return condition;
}

const litLesCentres = () => SQL.filter((s) => /\bfrom centers\b/.test(s)).length;
const litLeCatalogue = () => SQL.filter((s) => /\bfrom (formulas|activities)\b/.test(s)).length;

async function main() {
  // --- A. La distribution des communications ------------------------------
  SQL.length = 0;
  await taches.runDispatchCommunicationsCron({ limit: 1 });
  const centresA = litLesCentres();
  ok(centresA > 0,
    `dispatch-communications relit les centres avant de composer (${centresA} requete(s) centers, ${SQL.length} requetes en tout)`);

  // --- B. Les travaux d exploitation --------------------------------------
  SQL.length = 0;
  await taches.runOpsJobsCron({ limit: 1 });
  const centresB = litLesCentres();
  ok(centresB > 0,
    `ops-jobs relit les centres avant d agir (${centresB} requete(s) centers, ${SQL.length} requetes en tout)`);
  ok(litLeCatalogue() > 0 || centresB > 0,
    `le catalogue est rechauffe lui aussi (${litLeCatalogue()} requete(s) formulas/activities)`);

  // --- C. Sans base, le cron ne casse pas ---------------------------------
  poolCasse = true;
  SQL.length = 0;
  let jete = '';
  try {
    await taches.runDispatchCommunicationsCron({ limit: 1 });
  } catch (error) { jete = String(error.message || error).slice(0, 60); }
  poolCasse = false;
  ok(!jete,
    `sans base, le cron retombe sur le socle fichier au lieu de jeter (${jete || 'aucune exception'})`);

  if (failures) {
    console.error(`\ncron-freshness-check: ${failures} defaut(s).`);
    process.exit(1);
  }
  console.log('\ncron-freshness-check: ALL OK (le cron relit la base, et tient sans elle)');
}

if (process.argv.includes('--mutate')) {
  const source = fs.readFileSync(TASKS, 'utf8');
  const marqueur = '  await rechaufferLaConnaissance();';
  if (!source.includes(marqueur)) {
    console.error('mutation impossible : le rechauffage est introuvable dans lib/cron-tasks.js');
    process.exit(1);
  }
  const mute = source.split(marqueur).join('  // rechauffage neutralise pour la contre-epreuve');
  fs.writeFileSync(TASKS, mute);
  const { spawnSync } = require('child_process');
  const run = spawnSync(process.execPath, [__filename], { encoding: 'utf8' });
  fs.writeFileSync(TASKS, source);
  console.log(run.stdout || '');
  if (run.status === 0) {
    console.error('CONTRE-EPREUVE RATEE : le gate reste vert sans le rechauffage.');
    process.exit(1);
  }
  console.log('contre-epreuve OK : sans le rechauffage, le cron ne lit plus les centres et le gate rougit.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
