// Contrat des statuts de communications : la contrainte SQL doit couvrir TOUS
// les statuts que le code ecrit. Ne le degrade jamais en silence.
//
// Lecon payee en prod (2026-07-14 -> 2026-07-17) : la migration 0019 a reecrit
// communications_status_check pour ajouter 'received' et a PERDU 'processing'
// (le statut de claim du worker, pose par listDueOpsCommunications,
// lib/database.js). Plus aucun envoi automatique pendant 2,5 jours, echec
// silencieux toutes les 10 minutes. Ce gate rejoue la question a chaque CI :
// la DERNIERE definition de la contrainte (ordre des migrations) contient-elle
// chaque statut du contrat ?
//
// Regle anti-faux-vert : echec si aucune definition n'est trouvee (echantillon
// vide). Preuve : `node scripts/communications-status-contract-check.js
// <dossier-vide>` doit sortir en erreur.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const databaseDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'database');

// Le contrat : chaque statut et le code qui l'ecrit.
const REQUIRED_STATUSES = [
  'draft', //      brouillons composer (ops-communications)
  'queued', //     files d'attente (createCommunication)
  'processing', // claim du worker sans double envoi (database.js listDueCommunications)
  'sent', //       envoi effectue
  'delivered', //  confirmation provider
  'failed', //     echec d'envoi
  'cancelled', //  annulation (resa modifiee/annulee)
  'received', //   emails ENTRANTS (webhook/collage, email-agent 0019)
];

function fail(message) {
  console.error(`communications-status-contract-check: FAIL ${message}`);
  process.exit(1);
}

if (!fs.existsSync(databaseDir)) fail(`dossier introuvable: ${databaseDir}`);

// L'ordre fait foi : la contrainte effective est celle de la DERNIERE migration
// qui la definit. On suit MIGRATIONS[] (le meme ordre que le runner applique).
const { MIGRATIONS } = require('./run-db-migrations');
if (!Array.isArray(MIGRATIONS) || MIGRATIONS.length < 5) fail('liste MIGRATIONS vide ou anormale');

let lastDefinition = null;
let lastSource = null;
for (const migration of MIGRATIONS) {
  const target = databaseDir === path.join(root, 'database')
    ? path.join(root, migration.file)
    : path.join(databaseDir, path.basename(migration.file));
  if (!fs.existsSync(target)) continue;
  const sql = fs.readFileSync(target, 'utf8');
  const match = sql.match(/add\s+constraint\s+communications_status_check\s+check\s*\(status\s+in\s*\(([^)]+)\)\)/is);
  if (match) {
    lastDefinition = match[1];
    lastSource = migration.id;
  }
}

if (!lastDefinition) fail(`aucune definition de communications_status_check trouvee dans ${databaseDir} (echantillon vide)`);

const declared = [...lastDefinition.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
if (declared.length < 3) fail(`definition suspecte dans ${lastSource} : ${declared.join(', ')}`);

const missing = REQUIRED_STATUSES.filter((status) => !declared.includes(status));
if (missing.length) {
  fail(`la contrainte (${lastSource}) perd des statuts que le code ecrit : ${missing.join(', ')}. C'est exactement la panne du 2026-07-14 : ajoute-les dans une NOUVELLE migration.`);
}

console.log(`communications-status-contract-check: ALL OK (${lastSource} declare ${declared.length} statuts, contrat ${REQUIRED_STATUSES.length}/${REQUIRED_STATUSES.length} couvert)`);
