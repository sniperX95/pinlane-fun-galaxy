// PURGE des donnees de TEST avant lancement, tous centres.
//
// Ce que ce script fait : vider les donnees d'ACTIVITE (reservations et tout ce
// qui en decoule) pour que le client demarre sur une base propre.
// Ce qu'il ne touche JAMAIS : la CONFIGURATION et les ACCES.
//
//   GARDE : centers, clients, staff_roles, staff_members (dont le code
//           founder), staff_sessions (ne pas deconnecter une session en cours),
//           activities, formule_overrides, email_templates, email_identities,
//           center_automation_settings, agent_facts (ce que l'equipe a
//           appris a l'agent), availability_blocks, lane_statuses,
//           weather_daily_forecast (cache), audit_log (journal de securite :
//           l'effacer supprimerait la trace des acces, ce n'est pas une donnee
//           visible du client).
//
// Securite :
//   1. DRY-RUN par defaut. Il faut --apply pour ecrire quoi que ce soit.
//   2. BACKUP JSON integral ecrit AVANT toute suppression. Sans backup, rien.
//   3. Une seule TRANSACTION : tout passe ou rien ne passe.
//   4. Refus si une reservation FUTURE existe (quelqu'un attendrait d'etre
//      servi) - sauf --force-future, a n'utiliser qu'en connaissance de cause.
//
// Usage :
//   node --env-file=.env scripts/purge-test-data.js            (dry-run)
//   node --env-file=.env scripts/purge-test-data.js --apply

const fs = require('fs');
const path = require('path');
const { getPool } = require('../lib/database');

const APPLY = process.argv.includes('--apply');
const FORCE_FUTURE = process.argv.includes('--force-future');

// Ordre = enfants d'abord. Une FK non satisfaite ferait echouer la transaction
// entiere, donc l'ordre est une precaution, pas une garantie a lui seul.
const PURGE_TABLES = [
  'ops_decision_logs',
  'ops_delay_incidents',
  'ops_events',
  'ops_jobs',
  'ops_agent_suggestions',
  'ops_simulation_runs',
  'communications',
  'client_notes',
  'client_errors',
  'custom_requests',
  'campaigns',
  'marketing_agent_runs',
  'marketing_agent_criteria',
  'marketing_insights',
  'marketing_plans',
  'marketing_social_observations',
  'marketing_arms',
  'marketing_patterns',
  'marketing_suppressions',
  'marketing_competitors',
  'direction_reports',
  'daily_center_metrics',
  'staff_access_events',
  'email_agent_memory',
  'reservations', // en dernier : tout le reste y fait reference
];

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

(async () => {
  const pool = getPool();
  const exists = async (t) => (await pool.query(
    "select 1 from information_schema.tables where table_schema='public' and table_name=$1;", [t])).rowCount > 0;

  // ---- Garde-fou : rien d'engageant ne doit disparaitre -------------------
  const futures = await pool.query(
    "select count(*)::int n from reservations where date >= (now() at time zone 'Europe/Brussels')::date and status <> 'cancelled';");
  const futureCount = futures.rows[0].n;
  console.log(`Reservations FUTURES non annulees : ${futureCount}`);
  if (futureCount > 0 && !FORCE_FUTURE) {
    console.error(`\nREFUS : ${futureCount} reservation(s) future(s) existe(nt). Quelqu'un attend d'etre servi.`);
    console.error('Verifie-les d abord. Pour passer outre en connaissance de cause : --force-future');
    await pool.end();
    process.exit(1);
  }

  // ---- Inventaire de ce qui partirait -------------------------------------
  console.log(`\n=== CE QUI ${APPLY ? 'VA ETRE SUPPRIME' : 'SERAIT SUPPRIME (dry-run)'} ===`);
  const present = [];
  let total = 0;
  for (const t of PURGE_TABLES) {
    if (!await exists(t)) continue;
    const n = (await pool.query(`select count(*)::int n from ${t};`)).rows[0].n;
    if (n === 0) continue;
    present.push({ table: t, n });
    total += n;
    console.log(`  ${pad(t, 32)} ${num(n, 7)} ligne(s)`);
  }
  console.log(`  ${pad('TOTAL', 32)} ${num(total, 7)} ligne(s) sur ${present.length} table(s)`);

  if (!total) {
    console.log('\nRien a purger : la base est deja propre.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('\nDRY-RUN : rien n a ete modifie. Relance avec --apply pour executer.');
    await pool.end();
    return;
  }

  // ---- BACKUP INTEGRAL avant toute ecriture -------------------------------
  const stamp = (await pool.query('select to_char(now(), \'YYYY-MM-DD"T"HH24-MI-SS\') s;')).rows[0].s;
  const dir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `backup-purge-${stamp}.json`);

  const backup = { generatedAt: stamp, tables: {} };
  for (const { table } of present) {
    backup.tables[table] = (await pool.query(`select * from ${table};`)).rows;
  }
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1));
  const sizeKb = Math.round(fs.statSync(backupPath).size / 1024);
  console.log(`\nBACKUP ecrit : ${path.relative(path.join(__dirname, '..'), backupPath)} (${sizeKb} Ko)`);

  // Un backup vide ou tronque rendrait la purge irreversible : on le relit.
  const reread = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const backedUp = Object.values(reread.tables).reduce((s, rows) => s + rows.length, 0);
  if (backedUp !== total) {
    console.error(`REFUS : le backup contient ${backedUp} lignes pour ${total} attendues. Purge annulee.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`Backup verifie : ${backedUp} lignes relues.`);

  // ---- Purge en UNE transaction ------------------------------------------
  const client = await pool.connect();
  const deleted = {};
  try {
    await client.query('BEGIN');
    for (const { table } of present) {
      const res = await client.query(`delete from ${table};`);
      deleted[table] = res.rowCount;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nECHEC, transaction annulee (rien n a ete supprime) : ${error.message}`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();

  console.log('\n=== SUPPRIME ===');
  Object.entries(deleted).forEach(([t, n]) => console.log(`  ${pad(t, 32)} ${num(n, 7)}`));

  // ---- Verification apres --------------------------------------------------
  console.log('\n=== VERIFICATION ===');
  let residual = 0;
  for (const { table } of present) {
    const n = (await pool.query(`select count(*)::int n from ${table};`)).rows[0].n;
    residual += n;
    if (n) console.log(`  RESTE ${n} dans ${table}`);
  }
  console.log(`  residuel total : ${residual}`);

  for (const t of ['centers', 'clients', 'staff_roles', 'staff_members', 'activities']) {
    if (!await exists(t)) continue;
    const n = (await pool.query(`select count(*)::int n from ${t};`)).rows[0].n;
    console.log(`  PRESERVE ${pad(t, 20)} ${num(n, 5)} ligne(s)`);
  }

  await pool.end();
  console.log(`\nPurge terminee. Restauration possible depuis ${path.basename(backupPath)}.`);
})().catch((error) => {
  console.error('purge: erreur', error.message);
  process.exit(1);
});
